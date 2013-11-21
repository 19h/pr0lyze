var http = require("http"), fs = require("fs");
var lvl = require("hyperlevel")("./db"),
vrs = require("level-version");

var r = 17;

var ProgressBar = require('progress');

var dt = vrs(lvl), dfq = dt.createVersionStream("", {});
var ls = 0, lt = 0, lu = 0;
var state = 0, total, offset;

var get = function (opt, cb) {
	http.request({
		hostname: "pr0gramm.com",
		port: 80,
		path: "/api/items/get.json?q=*&" + opt,
		method: "GET"
	}, function (res) {
		var data = "";

		res.on("data", function (chunk) {
			data += chunk;
		})

		res.on("end", function (){
			cb(JSON.parse(data));
		});
	}).end()
}

console.log("== pr0lyze r%s ==", r, "\n")

dt.createVersionStream("", {
	limit: 1
}).on("data", function(entry) {
	lt = +entry.version
}).on("end", function () {
	console.log("[STATE]");

	get("count=1", function (data) {
		if (lt) {
			console.log("\tLatest local key:", lt)

			var delta = data.items[0].id - lt;
			var mo = lt - data.total;
			var to = delta + mo;

			console.log("\tLatest remote key:", data.items[0].id);
			console.log("\tDelta:", delta);

			console.log("\n\tModeration Offset:", mo)
			console.log("\tTotal offset:", to);

			total = data.total;
			state = lt - to;
			offset = data.total - state;
		} else {
			console.log("\t[No data]");

			total = data.total;
			offset = total;
		}

		console.log("\n\tDetermined start:", state, "\n");

		init()
	});
})

var init = function () {
	console.log("[SYNC]")

	var tickSize = offset > 255 ? 255 : offset;

	var start = function () {
		if (state < total)
			get("count=" + tickSize + "&start=" + state, function (data) {
				data.items.forEach(function(data) {
					var dtset = [data.created, data.tags.join("\xF1"), data.channel.name, data.user.name, data.user.nick, data.user.admin].join("\xFF")
					
					dt.put("", dtset, {version: data.id});
				})

				total = data.total;
				bar.tick(tickSize);
				state += tickSize;

				start();
			})
		else
			analyze();
	}

	if (state < total) {
		var bar = new ProgressBar('\tSyncing [:bar] :percent :etas', {
			complete: '=',
			incomplete: ' ',
			width: 50,
			total: offset
		});

		process.nextTick(start);
	} else {
		console.log("\tNothing to do.");
		(!fs.existsSync("data.json") ? analyze() : console.log(""));

		// kill the shutdown lag
		// introduced by the event loop
		process.exit()
	}
};

var analyze = function () {
	dfq = dt.createVersionStream("", { reverse: true });

	var cs = {};

	console.log("\n[ANALYSIS]");

	var bar = new ProgressBar('\tAnalyzing [:bar] :percent :etas', {
		complete: '=',
		incomplete: ' ',
		width: 50,
		total: total
	});

	dfq.on("data", function (entry) {
		var ch = entry.value.split("\xFF");

		cs[ch[2]] && ++cs[ch[2]][0] || (cs[ch[2]] = [1, {}, 1])

		var tags = ch[1].split("\xF1");

		tags.forEach(function (v) {
			if(!v)return;

			cs[ch[2]][1][v] && ++cs[ch[2]][1][v] || (cs[ch[2]][1][v] = 1);
			++cs[ch[2]][2];
		})

		bar.tick(1);
	}).on("end", function () {
		var ct = Object.keys(cs).map(function (v) {
			return [v, cs[v]]
		}).sort(function (a, b) {
			return b[1] - a[1]
		}).map(function (v) {
	 		return [v[0], [v[1][0], Object.keys(v[1][1]).map(function (b) {
				return [b, v[1][1][b]]
			}).sort(function (a, b) {
				return b[1] - a[1]
			}), v[1][2]]]
		})

		process.stdout.write("\n\tWriting report.. ");

		fs.writeFile("data.json", JSON.stringify(ct), function (err) {
			if (err) process.stdout.write("failed.");

			process.stdout.write("done.\n\n");
		})
	})
}
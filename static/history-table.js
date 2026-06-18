function rank(rating) {
	if (rating < 400) return "gray";
	if (rating < 800) return "brown";
	if (rating < 1200) return "green";
	if (rating < 1600) return "cyan";
	if (rating < 2000) return "blue";
	if (rating < 2400) return "yellow";
	if (rating < 2800) return "orange";
	return "red";
};

function tabler(type) {
	const title = document.getElementById("title")
	let url;
	if (type==="atcoder") {
		title.innerText = "AtCoder コンテスト成績表";
		url="https://atcoder.jp/contests/";
	} else {
		title.innerText = "OnlineMathContest コンテスト成績表";
		url="https://onlinemathcontest.com/contests/";
	};
	fetch("https://yamato0915.xsrv.jp/api/" + type + "/rating")
	.then(response => response.json())
	.then(data => {
		if (type === "atcoder") {
			const th = document.createElement("th");
			th.scope = "col";
			document.getElementById("theadtr").appendChild(th);
		};
		const tbody = document.getElementById("tbody")
		for (const contest of data.reverse()) {
			const tr = document.createElement("tr");
			const contestname = contest["ContestScreenName"].split(".")[0];
			const diff = contest["NewRating"] - contest["OldRating"];
			const diffText = 
				diff > 0 ? `+${diff}`
				: diff === 0 ? "±0"
				: `${diff}`;
			tr.innerHTML = `
				<td>${contest["Day"]}</td>
				<td class="text-start">
					<a class="text-decoration-none" href="${url}${contestname}">${contest["ContestName"]}</a>
					${type==="atcoder" ? `<a class="link-dark text-decoration-none" href="${url}${contestname}/submissions?f.User=Yamato0915"><i class="bi bi-search"></i></a>` : ""}
				</td>
				<td><a class="text-decoration-none" href="${url}${contestname}/standings?watching=Yamato0915">${contest["Place"]}</a></td>
				<td class="${rank(contest["Performance"])}">${contest["Performance"]}</td>
				<td class="${rank(contest["NewRating"])}">${contest["NewRating"]}</td>
				<td>
					${diffText}
				</td>
				${type==="atcoder" ? `<td><a href="https://atcoder.jp/users/Yamato0915/history/share/${contestname}"><i class="bi bi-share-fill"></i></a></td>` : ""}
			`
			tbody.appendChild(tr)
		};
	});
};
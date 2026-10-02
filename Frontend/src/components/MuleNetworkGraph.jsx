import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import cashOutIcon from "../assets/cash-out-icon.png";
import { getErrorMessage, isApiConfigured } from "../api/client";
import { getGraphNote, submitGraphNote } from "../api/notes";

function ZoomInIcon({ className = "h-5 w-5" }) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
			<circle cx="11" cy="11" r="7" />
			<path d="M21 21l-4.3-4.3" />
			<path d="M11 8v6M8 11h6" />
		</svg>
	);
}

function ZoomOutIcon({ className = "h-5 w-5" }) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
			<circle cx="11" cy="11" r="7" />
			<path d="M21 21l-4.3-4.3" />
			<path d="M8 11h6" />
		</svg>
	);
}

function appendUserIcon(selection, { radius = 44, fill = "#111", iconFill = "#fff" } = {}) {
	selection.append("circle").attr("r", radius).attr("fill", fill).attr("stroke", "none");
	const s = radius / 20;
	selection
		.append("g")
		.attr("transform", `scale(${s})`)
		.attr("pointer-events", "none")
		.html(
			`<circle cx="0" cy="-5.5" r="5.2" fill="${iconFill}"/>` +
				`<path fill="${iconFill}" d="M-11 12.5c0-5.2 4.9-8.2 11-8.2s11 3 11 8.2V14H-11v-1.5z"/>`,
		);
}

function nodeRadius(node, detailed) {
	if (node.kind === "cashout") {
		return detailed ? 42 : 38;
	}
	return detailed ? 48 : 44;
}

function computeLayout(nodes, links, width, height, detailed) {
	const hasFixed = nodes.every((node) => typeof node.fx === "number" && typeof node.fy === "number");
	if (hasFixed) {
		const nodeById = new Map(
			nodes.map((node) => [
				node.id,
				{
					...node,
					x: node.fx * width,
					y: node.fy * height,
					r: nodeRadius(node, detailed),
				},
			]),
		);
		const resolvedLinks = links
			.map((link) => {
				const sourceId = typeof link.source === "object" ? link.source.id : link.source;
				const targetId = typeof link.target === "object" ? link.target.id : link.target;
				const source = nodeById.get(sourceId);
				const target = nodeById.get(targetId);
				if (!source || !target) {
					return null;
				}
				return { ...link, source, target };
			})
			.filter(Boolean);
		// Fixed layouts use hand-picked proportions -- no dynamic spacing needed.
		return { nodes: [...nodeById.values()], links: resolvedLinks, height };
	}
	return computeLayeredLayout(nodes, links, width, height, detailed);
}

function computeLayeredLayout(nodes, links, width, height, detailed) {
	const nodeById = new Map(nodes.map((node) => [node.id, { ...node }]));
	const accounts = nodes.filter((node) => node.kind === "account").map((node) => node.id);
	const accountSet = new Set(accounts);
	const outgoing = new Map(accounts.map((id) => [id, []]));
	const incoming = new Map(accounts.map((id) => [id, []]));

	for (const link of links) {
		if (link.isCashOut) {
			continue;
		}
		const sourceId = typeof link.source === "object" ? link.source.id : link.source;
		const targetId = typeof link.target === "object" ? link.target.id : link.target;
		if (!accountSet.has(sourceId) || !accountSet.has(targetId)) {
			continue;
		}
		outgoing.get(sourceId).push(targetId);
		incoming.get(targetId).push(sourceId);
	}

	const layer = new Map();
	const roots = accounts.filter((id) => (incoming.get(id) || []).length === 0);
	const startNodes = roots.length > 0 ? roots : [accounts[0]].filter(Boolean);
	for (const id of startNodes) {
		layer.set(id, 0);
	}

	const queue = [...startNodes];
	while (queue.length > 0) {
		const current = queue.shift();
		const currentLayer = layer.get(current) ?? 0;
		for (const next of outgoing.get(current) || []) {
			const proposed = currentLayer + 1;
			if (!layer.has(next) || proposed > layer.get(next)) {
				layer.set(next, proposed);
				queue.push(next);
			}
		}
	}

	for (const id of accounts) {
		if (!layer.has(id)) {
			const preds = incoming.get(id) || [];
			const predLayers = preds.map((pred) => layer.get(pred)).filter((value) => value != null);
			layer.set(id, predLayers.length > 0 ? Math.max(...predLayers) + 1 : 0);
		}
	}

	const maxLayer = Math.max(0, ...[...layer.values()]);
	const columns = Array.from({ length: maxLayer + 1 }, () => []);
	for (const id of accounts) {
		columns[layer.get(id)].push(id);
	}
	for (const column of columns) {
		column.sort((a, b) => {
			const nameA = nodeById.get(a)?.label ?? nodeById.get(a)?.lastName ?? a;
			const nameB = nodeById.get(b)?.label ?? nodeById.get(b)?.lastName ?? b;
			return String(nameA).localeCompare(String(nameB)) || a.localeCompare(b);
		});
	}

	const marginX = detailed ? 140 : 100;
	const marginY = detailed ? 120 : 90;
	const usableWidth = Math.max(180, width - marginX * 2);

	// Minimum center-to-center gap between two account nodes stacked in the
	// same column, so a cluster with many accounts in one layer doesn't
	// compress them into an overlapping pile -- the canvas grows taller
	// instead, and the existing zoom/pan controls handle showing all of it.
	const accountDiameter = nodeRadius({ kind: "account" }, detailed) * 2;
	const minRowSpacing = accountDiameter + (detailed ? 36 : 24);
	const largestColumnSize = Math.max(1, ...columns.map((column) => column.length));
	const requiredHeight = (largestColumnSize - 1) * minRowSpacing;

	const usableHeight = Math.max(180, height - marginY * 2, requiredHeight);
	const totalHeight = usableHeight + marginY * 2;
	const columnGap = maxLayer === 0 ? 0 : usableWidth / maxLayer;

	columns.forEach((column, columnIndex) => {
		const x = marginX + columnIndex * columnGap;
		const count = column.length;
		const spread = count <= 2 ? usableHeight * 0.55 : usableHeight;
		const top = marginY + (usableHeight - spread) / 2;
		column.forEach((id, rowIndex) => {
			const y = count === 1 ? marginY + usableHeight / 2 : top + (rowIndex / (count - 1)) * spread;
			const node = nodeById.get(id);
			node.x = x;
			node.y = y;
			node.r = nodeRadius(node, detailed);
		});
	});

	const cashOutOffsetX = detailed ? 170 : 130;
	const cashOutOffsets = new Map();
	for (const link of links) {
		if (!link.isCashOut) {
			continue;
		}
		const sourceId = typeof link.source === "object" ? link.source.id : link.source;
		const targetId = typeof link.target === "object" ? link.target.id : link.target;
		const source = nodeById.get(sourceId);
		const target = nodeById.get(targetId);
		if (!source || !target) {
			continue;
		}
		const stackIndex = cashOutOffsets.get(sourceId) ?? 0;
		cashOutOffsets.set(sourceId, stackIndex + 1);
		target.x = source.x + cashOutOffsetX;
		target.y = source.y + stackIndex * (detailed ? 96 : 72);
		target.r = nodeRadius(target, detailed);
	}

	const positioned = [...nodeById.values()].filter((node) => node.x != null && node.y != null);
	const resolvedLinks = links
		.map((link) => {
			const sourceId = typeof link.source === "object" ? link.source.id : link.source;
			const targetId = typeof link.target === "object" ? link.target.id : link.target;
			const source = nodeById.get(sourceId);
			const target = nodeById.get(targetId);
			if (!source || !target) {
				return null;
			}
			return { ...link, source, target };
		})
		.filter(Boolean);

	return { nodes: positioned, links: resolvedLinks, height: totalHeight };
}

function edgePoint(node, side) {
	const r = (node.r ?? 44) + 2;
	switch (side) {
		case "left":
			return { x: node.x - r, y: node.y };
		case "right":
			return { x: node.x + r, y: node.y };
		case "top":
			return { x: node.x, y: node.y - r };
		case "bottom":
			return { x: node.x, y: node.y + r };
		default:
			return { x: node.x, y: node.y };
	}
}

function routePoints(d) {
	const route = d.route;
	const s = d.source;
	const t = d.target;

	if (route === "horizontal" || (!route && Math.abs(s.y - t.y) < 12)) {
		const start = edgePoint(s, s.x <= t.x ? "right" : "left");
		const end = edgePoint(t, s.x <= t.x ? "left" : "right");
		return [start, end];
	}

	if (route === "vertical-up" || route === "vertical-down" || (!route && Math.abs(s.x - t.x) < 12)) {
		const goingDown = t.y > s.y;
		const start = edgePoint(s, goingDown ? "bottom" : "top");
		const end = edgePoint(t, goingDown ? "top" : "bottom");
		return [start, end];
	}

	if (route === "down-then-right") {
		const start = edgePoint(s, "bottom");
		const end = edgePoint(t, "left");
		const midY = Math.max(start.y, end.y) + 28;
		return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
	}

	if (route === "up-then-right") {
		const start = edgePoint(s, "top");
		const end = edgePoint(t, "left");
		return [start, { x: start.x, y: end.y }, end];
	}

	if (route === "step-up-right") {
		const start = edgePoint(s, "right");
		const end = edgePoint(t, "left");
		const midX = (start.x + end.x) / 2;
		return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
	}

	if (route === "around-left") {
		const start = edgePoint(s, "left");
		const end = edgePoint(t, "bottom");
		const leftX = Math.min(start.x, end.x) - 70;
		const bottomY = Math.max(start.y, end.y) + 70;
		return [start, { x: leftX, y: start.y }, { x: leftX, y: bottomY }, { x: end.x, y: bottomY }, end];
	}

	if (route === "cashout" || d.isCashOut) {
		const start = edgePoint(s, t.x >= s.x ? "right" : "left");
		const end = edgePoint(t, t.x >= s.x ? "left" : "right");
		if (Math.abs(start.y - end.y) < 10) {
			return [start, end];
		}
		const midX = (start.x + end.x) / 2;
		return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
	}

	const start = edgePoint(s, s.x <= t.x ? "right" : "left");
	const end = edgePoint(t, s.x <= t.x ? "left" : "right");
	const midX = (start.x + end.x) / 2;
	return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
}

function linkPath(d) {
	const points = routePoints(d);
	if (points.length === 2) {
		return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`;
	}

	const corner = 18;
	let path = `M${points[0].x},${points[0].y}`;
	for (let i = 1; i < points.length - 1; i += 1) {
		const prev = points[i - 1];
		const curr = points[i];
		const next = points[i + 1];
		const inDx = curr.x - prev.x;
		const inDy = curr.y - prev.y;
		const outDx = next.x - curr.x;
		const outDy = next.y - curr.y;
		const inLen = Math.hypot(inDx, inDy) || 1;
		const outLen = Math.hypot(outDx, outDy) || 1;
		const r = Math.min(corner, inLen / 2 - 1, outLen / 2 - 1);
		if (r < 2) {
			path += ` L${curr.x},${curr.y}`;
			continue;
		}
		const ix = curr.x - (inDx / inLen) * r;
		const iy = curr.y - (inDy / inLen) * r;
		const ox = curr.x + (outDx / outLen) * r;
		const oy = curr.y + (outDy / outLen) * r;
		path += ` L${ix},${iy} Q${curr.x},${curr.y} ${ox},${oy}`;
	}
	const last = points[points.length - 1];
	path += ` L${last.x},${last.y}`;
	return path;
}

function linkLabelPoint(d) {
	const points = routePoints(d);
	if (points.length >= 3) {
		const mid = points[Math.floor((points.length - 1) / 2)];
		return { x: mid.x, y: mid.y };
	}
	return {
		x: (points[0].x + points[1].x) / 2,
		y: (points[0].y + points[1].y) / 2,
	};
}

function sameId(a, b) {
	if (a == null || b == null) {
		return false;
	}
	return String(a) === String(b);
}

function endpointId(end) {
	return typeof end === "object" && end ? end.id : end;
}

function linkTxId(link) {
	return link?.txId ?? link?.id ?? null;
}

function linkTouchesNode(link, nodeId) {
	return sameId(endpointId(link.source), nodeId) || sameId(endpointId(link.target), nodeId);
}

function clampPopupPosition(container, event, popupWidth, popupHeight) {
	const rect = container.getBoundingClientRect();
	let x = event.clientX - rect.left + 14;
	let y = event.clientY - rect.top + 14;
	if (x + popupWidth > rect.width - 8) {
		x = Math.max(8, event.clientX - rect.left - popupWidth - 14);
	}
	if (y + popupHeight > rect.height - 8) {
		y = Math.max(8, rect.height - popupHeight - 8);
	}
	return { x, y };
}

function formatPopupAmount(amount, currency) {
	const numeric = typeof amount === "string" ? Number(amount.replace(/,/g, "")) : Number(amount);
	const formatted = Number.isFinite(numeric)
		? numeric.toLocaleString("en-US", {
				minimumFractionDigits: 0,
				maximumFractionDigits: 2,
			})
		: (amount ?? "—");
	return currency ? `${formatted} ${currency}` : formatted;
}

function EdgeTransactionPopup({ tx, x, y, onClose, isDark }) {
	const rows = [
		["Transaction ID", tx.id ?? "—"],
		["Timestamp", tx.timestamp ?? "—"],
		["Sender Bank", tx.sender?.bank ?? "—"],
		["Sender Account ID", tx.sender?.account_number ?? "—"],
		["Receiver Bank", tx.isCashOut ? "—" : (tx.receiver?.bank ?? "—")],
		["Receiver Account ID", tx.isCashOut ? "—" : (tx.receiver?.account_number ?? "—")],
		["Amount", formatPopupAmount(tx.amount, tx.currency)],
		["Transaction Format", tx.payment_format ?? "—"],
	];

	return (
		<div
			role="dialog"
			aria-label={`Transaction ${tx.id} details`}
			className={`absolute z-20 w-72 max-h-[min(340px,calc(100%-16px))] overflow-auto rounded-lg border px-3 py-2.5 text-xs shadow-xl ${
				isDark ? "border-zinc-600 bg-zinc-900 text-zinc-100" : "border-zinc-200 bg-white text-zinc-900"
			}`}
			style={{ left: x, top: y }}
			onMouseDown={(event) => event.stopPropagation()}
			onClick={(event) => event.stopPropagation()}
		>
			<div className="mb-2 flex items-start justify-between gap-2">
				<p className="font-semibold">Transaction details</p>
				<button
					type="button"
					className="flex h-6 w-6 items-center justify-center rounded text-base leading-none text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
					aria-label="Close transaction details"
					onClick={onClose}
				>
					×
				</button>
			</div>
			<dl className="space-y-1.5">
				{rows.map(([label, value]) => (
					<div key={label} className="grid grid-cols-[7.5rem_1fr] gap-x-2">
						<dt className="text-zinc-500 dark:text-zinc-400">{label}:</dt>
						<dd className="break-all font-medium">{value}</dd>
					</div>
				))}
			</dl>
		</div>
	);
}

function NodeAccountPopup({ node, transactionCount, x, y, onClose, isDark }) {
	const rows = [
		["Account Bank ID", node.bank ?? "—"],
		["Account ID", node.account_number ?? "—"],
		["Total number of transactions", transactionCount],
	];

	return (
		<div
			role="dialog"
			aria-label={`Account ${node.account_number ?? node.id} details`}
			className={`absolute z-20 w-72 max-h-[min(240px,calc(100%-16px))] overflow-auto rounded-lg border px-3 py-2.5 text-xs shadow-xl ${
				isDark ? "border-zinc-600 bg-zinc-900 text-zinc-100" : "border-zinc-200 bg-white text-zinc-900"
			}`}
			style={{ left: x, top: y }}
			onMouseDown={(event) => event.stopPropagation()}
			onClick={(event) => event.stopPropagation()}
		>
			<div className="mb-2 flex items-start justify-between gap-2">
				<p className="font-semibold">Account details</p>
				<button
					type="button"
					className="flex h-6 w-6 items-center justify-center rounded text-base leading-none text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
					aria-label="Close account details"
					onClick={onClose}
				>
					×
				</button>
			</div>
			<dl className="space-y-1.5">
				{rows.map(([label, value]) => (
					<div key={label} className="grid grid-cols-[9.5rem_1fr] gap-x-2">
						<dt className="text-zinc-500 dark:text-zinc-400">{label}:</dt>
						<dd className="break-all font-medium">{value}</dd>
					</div>
				))}
			</dl>
		</div>
	);
}

function renderStaticGraph({
	container,
	graphId,
	nodes,
	links,
	isDark,
	detailed,
	cashOutIconUrl,
	zoomApiRef,
	highlightApiRef,
	interactionRef,
	selection = null,
	transactions = [],
}) {
	const width = container.clientWidth || (detailed ? 960 : 640);
	const height = container.clientHeight || (detailed ? 640 : 380);
	const linkStroke = isDark ? "#a1a1aa" : "#9a9a9a";
	const highlightStroke = isDark ? "#38bdf8" : "#0284c7";
	const labelFill = isDark ? "#f4f4f5" : "#18181b";
	const cashOutLabel = "#16a34a";
	const bgFill = isDark ? "#18181b" : "#ececec";
	const userFill = "#111111";
	const markerId = `arrow-${graphId}-${detailed ? "detail" : "simple"}`;
	const highlightMarkerId = `${markerId}-hi`;

	const visibleNodes = detailed ? nodes : nodes.filter((node) => node.kind === "account");
	const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
	const visibleLinks = detailed
		? links
		: links.filter((link) => {
				const sourceId = typeof link.source === "object" ? link.source.id : link.source;
				const targetId = typeof link.target === "object" ? link.target.id : link.target;
				return !link.isCashOut && visibleNodeIds.has(sourceId) && visibleNodeIds.has(targetId);
			});

	const layout = computeLayout(visibleNodes, visibleLinks, width, height, detailed);
	const graphInteractive = Boolean(interactionRef?.current?.onSelect);

	const svg = d3
		.select(container)
		.append("svg")
		.attr("width", "100%")
		.attr("height", "100%")
		.attr("viewBox", `0 0 ${width} ${height}`)
		.attr("role", "img")
		.attr("aria-label", `${detailed ? "Detailed" : "Simplified"} mule network ${graphId}`)
		.style("cursor", "grab");

	const defs = svg.append("defs");
	defs
		.append("marker")
		.attr("id", markerId)
		.attr("viewBox", "0 -5 10 10")
		.attr("refX", 9)
		.attr("refY", 0)
		.attr("markerWidth", 8)
		.attr("markerHeight", 8)
		.attr("orient", "auto")
		.append("path")
		.attr("d", "M0,-5L10,0L0,5")
		.attr("fill", linkStroke);

	defs
		.append("marker")
		.attr("id", highlightMarkerId)
		.attr("viewBox", "0 -5 10 10")
		.attr("refX", 9)
		.attr("refY", 0)
		.attr("markerWidth", 8)
		.attr("markerHeight", 8)
		.attr("orient", "auto")
		.append("path")
		.attr("d", "M0,-5L10,0L0,5")
		.attr("fill", highlightStroke);

	const viewport = svg.append("g").attr("class", "viewport");

	const link = viewport
		.append("g")
		.attr("class", "links")
		.attr("fill", "none")
		.selectAll("path")
		.data(layout.links)
		.join("path")
		.attr("class", "graph-link")
		.attr("stroke", linkStroke)
		.attr("stroke-width", 2.2)
		.attr("stroke-opacity", 0.95)
		.attr("stroke-linecap", "round")
		.attr("stroke-linejoin", "round")
		.attr("marker-end", `url(#${markerId})`)
		.attr("d", linkPath)
		.attr("pointer-events", "none");

	const linkHit = viewport
		.append("g")
		.attr("class", "link-hits")
		.attr("fill", "none")
		.selectAll("path")
		.data(layout.links)
		.join("path")
		.attr("class", "edge-hit")
		.attr("stroke", "transparent")
		.attr("stroke-width", 18)
		.attr("stroke-linecap", "round")
		.attr("stroke-linejoin", "round")
		.attr("d", linkPath)
		.style("cursor", graphInteractive ? "pointer" : "inherit")
		.attr("pointer-events", graphInteractive ? "stroke" : "none");

	const linkLabel = detailed
		? viewport
				.append("g")
				.selectAll("g")
				.data(layout.links)
				.join("g")
				.attr("pointer-events", "none")
				.attr("transform", (d) => {
					const point = linkLabelPoint(d);
					return `translate(${point.x},${point.y})`;
				})
		: null;

	if (linkLabel) {
		linkLabel.each(function (d) {
			const g = d3.select(this);
			const amountPrefix = d.currency === "USD" ? "$" : (d.currency ?? "$");
			g.append("text")
				.attr("text-anchor", "middle")
				.attr("y", -6)
				.attr("fill", labelFill)
				.attr("stroke", bgFill)
				.attr("stroke-width", 4)
				.attr("paint-order", "stroke")
				.attr("font-size", "13px")
				.attr("font-weight", "700")
				.attr("font-family", "system-ui, sans-serif")
				.text(`${amountPrefix} ${d.amount}`);
			g.append("text")
				.attr("text-anchor", "middle")
				.attr("y", 12)
				.attr("fill", labelFill)
				.attr("stroke", bgFill)
				.attr("stroke-width", 4)
				.attr("paint-order", "stroke")
				.attr("font-size", "11px")
				.attr("font-family", "system-ui, sans-serif")
				.text(d.ref);
		});
	}

	const node = viewport
		.append("g")
		.selectAll("g")
		.data(layout.nodes)
		.join("g")
		.attr("class", "graph-node node-hit")
		.attr("transform", (d) => `translate(${d.x},${d.y})`)
		.style("cursor", graphInteractive ? "pointer" : "inherit");

	node.each(function (d) {
		const g = d3.select(this);
		g.append("circle")
			.attr("class", "node-highlight-ring")
			.attr("r", (d.r ?? 44) + 7)
			.attr("fill", "none")
			.attr("stroke", highlightStroke)
			.attr("stroke-width", 3.5)
			.attr("opacity", 0)
			.attr("pointer-events", "none");
		if (d.kind === "cashout") {
			const radius = d.r ?? (detailed ? 42 : 38);
			const iconSize = radius * 1.55;
			const clipId = `cashout-clip-${graphId}-${detailed ? "d" : "s"}-${String(d.id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
			defs.append("clipPath").attr("id", clipId).append("circle").attr("r", radius);
			g.append("circle").attr("r", radius).attr("fill", "#ffffff").attr("stroke", cashOutLabel).attr("stroke-width", 3);
			g.append("image")
				.attr("href", cashOutIconUrl)
				.attr("x", -iconSize / 2)
				.attr("y", -iconSize / 2)
				.attr("width", iconSize)
				.attr("height", iconSize)
				.attr("clip-path", `url(#${clipId})`);
			g.append("circle").attr("r", radius).attr("fill", "none").attr("stroke", cashOutLabel).attr("stroke-width", 3).attr("pointer-events", "none");
			g.append("text")
				.text("Cash-Out")
				.attr("x", 0)
				.attr("y", radius + 18)
				.attr("text-anchor", "middle")
				.attr("fill", cashOutLabel)
				.attr("font-size", detailed ? "13px" : "12px")
				.attr("font-weight", "700")
				.attr("font-family", "system-ui, sans-serif")
				.attr("pointer-events", "none");
			return;
		}

		appendUserIcon(g, {
			radius: d.r ?? (detailed ? 48 : 44),
			fill: userFill,
			iconFill: "#ffffff",
		});

		if (detailed) {
			g.append("text")
				.text(
					d.bank && d.account_number
						? `${d.bank}/${d.account_number}`
						: (d.account_number ?? d.id),
				)
				.attr("x", 0)
				.attr("y", -(d.r ?? 48) - 12)
				.attr("text-anchor", "middle")
				.attr("fill", labelFill)
				.attr("stroke", bgFill)
				.attr("stroke-width", 4)
				.attr("paint-order", "stroke")
				.attr("font-size", "15px")
				.attr("font-weight", "600")
				.attr("font-family", "system-ui, sans-serif")
				.attr("pointer-events", "none");
		}
	});

	const resolveTxHighlight = (txId) => {
		if (txId == null) {
			return null;
		}
		const selectedLink = layout.links.find((item) => sameId(linkTxId(item), txId));
		if (selectedLink) {
			return {
				txIds: new Set([String(linkTxId(selectedLink))]),
				nodeIds: new Set([String(endpointId(selectedLink.source)), String(endpointId(selectedLink.target))]),
				focusNodeId: null,
			};
		}
		const txList = interactionRef?.current?.transactions ?? transactions;
		const tx = txList.find((item) => sameId(item.id, txId));
		if (!tx) {
			return null;
		}
		return {
			txIds: new Set([String(tx.id)]),
			nodeIds: new Set(
				[tx.sender?.id, tx.isCashOut ? `cashout-${tx.sender?.id}` : tx.receiver?.id].filter(Boolean).map(String),
			),
			focusNodeId: null,
		};
	};

	const resolveNodeHighlight = (nodeId) => {
		if (nodeId == null) {
			return null;
		}
		const txIds = new Set();
		const nodeIds = new Set([String(nodeId)]);
		layout.links.forEach((item) => {
			if (!linkTouchesNode(item, nodeId)) {
				return;
			}
			const txId = linkTxId(item);
			if (txId != null) {
				txIds.add(String(txId));
			}
			nodeIds.add(String(endpointId(item.source)));
			nodeIds.add(String(endpointId(item.target)));
		});
		return { txIds, nodeIds, focusNodeId: String(nodeId) };
	};

	const applyHighlight = (nextSelection) => {
		const highlight =
			nextSelection?.type === "node"
				? resolveNodeHighlight(nextSelection.id)
				: resolveTxHighlight(nextSelection?.type === "transaction" ? nextSelection.id : nextSelection);
		const txHighlighted = (d) => Boolean(highlight?.txIds?.has(String(linkTxId(d))));
		link
			.attr("stroke", (d) => (txHighlighted(d) ? highlightStroke : linkStroke))
			.attr("stroke-width", (d) => (txHighlighted(d) ? 4 : 2.2))
			.attr("stroke-opacity", (d) => {
				if (!highlight) {
					return 0.95;
				}
				return txHighlighted(d) ? 1 : 0.28;
			})
			.attr("marker-end", (d) => (txHighlighted(d) ? `url(#${highlightMarkerId})` : `url(#${markerId})`));
		node.select(".node-highlight-ring")
			.attr("opacity", (d) => (highlight?.nodeIds?.has(String(d.id)) ? 1 : 0))
			.attr("stroke-width", (d) => (highlight?.focusNodeId && sameId(d.id, highlight.focusNodeId) ? 4.5 : 3.5));
	};

	applyHighlight(selection);

	if (highlightApiRef) {
		highlightApiRef.current = { apply: applyHighlight };
	}

	const zoom = d3
		.zoom()
		.scaleExtent([0.45, 3.5])
		.filter((event) => {
			if (event.type === "wheel") {
				return true;
			}
			if (event.button) {
				return false;
			}
			if (!graphInteractive) {
				return true;
			}
			const target = event.target;
			if (target.classList?.contains("edge-hit")) {
				return false;
			}
			if (typeof target.closest === "function" && target.closest(".node-hit")) {
				return false;
			}
			return true;
		})
		.on("start", () => {
			svg.style("cursor", "grabbing");
		})
		.on("end", () => {
			svg.style("cursor", "grab");
		})
		.on("zoom", (event) => {
			viewport.attr("transform", event.transform);
		});

	svg.call(zoom);
	svg.on("dblclick.zoom", null);

	if (graphInteractive) {
		linkHit.on("click", (event, d) => {
			event.stopPropagation();
			const txId = linkTxId(d);
			const nextSelection = { type: "transaction", id: txId };
			applyHighlight(nextSelection);
			interactionRef?.current?.onSelect?.(nextSelection);
			if (interactionRef?.current?.enableEdgePopup) {
				interactionRef.current.openPopup?.(event, d);
			}
		});

		node.on("click", (event, d) => {
			event.stopPropagation();
			if (d.kind === "cashout") {
				return;
			}
			const nextSelection = { type: "node", id: d.id };
			applyHighlight(nextSelection);
			interactionRef?.current?.onSelect?.(nextSelection);
			if (interactionRef?.current?.enableNodePopup) {
				const transactionCount = layout.links.filter((item) => linkTouchesNode(item, d.id)).length;
				interactionRef.current.openNodePopup?.(event, d, transactionCount);
			}
		});

		svg.select("rect.graph-bg").on("click", (event) => {
			if (event.defaultPrevented) {
				return;
			}
			applyHighlight(null);
			interactionRef?.current?.onSelect?.(null);
		});
	}

	if (zoomApiRef) {
		zoomApiRef.current = {
			zoomIn: () => svg.transition().duration(180).call(zoom.scaleBy, 1.25),
			zoomOut: () => svg.transition().duration(180).call(zoom.scaleBy, 0.8),
		};
	}

	const resizeObserver = new ResizeObserver(() => {
		const nextWidth = container.clientWidth || width;
		const nextHeight = container.clientHeight || height;
		const nextLayout = computeLayout(visibleNodes, visibleLinks, nextWidth, nextHeight, detailed);
		svg.attr("viewBox", `0 0 ${nextWidth} ${nextHeight}`);
		const nextById = new Map(nextLayout.nodes.map((item) => [item.id, item]));
		layout.nodes.forEach((item) => {
			const next = nextById.get(item.id);
			if (next) {
				item.x = next.x;
				item.y = next.y;
				item.r = next.r;
			}
		});
		link.attr("d", linkPath);
		linkHit.attr("d", linkPath);
		if (linkLabel) {
			linkLabel.attr("transform", (d) => {
				const point = linkLabelPoint(d);
				return `translate(${point.x},${point.y})`;
			});
		}
		node.attr("transform", (d) => `translate(${d.x},${d.y})`);
	});
	resizeObserver.observe(container);

	return () => {
		if (zoomApiRef) {
			zoomApiRef.current = null;
		}
		if (highlightApiRef) {
			highlightApiRef.current = null;
		}
		resizeObserver.disconnect();
		svg.on(".zoom", null);
		svg.remove();
	};
}

function GraphCanvas({
	graphId,
	nodes,
	links,
	isDark,
	detailed,
	className = "",
	showExpand = false,
	onExpand,
	transactions = [],
	selection = null,
	onSelect,
	enableEdgePopup = false,
	enableNodePopup = false,
}) {
	const containerRef = useRef(null);
	const zoomApiRef = useRef(null);
	const highlightApiRef = useRef(null);
	const interactionRef = useRef({
		onSelect,
		enableEdgePopup,
		enableNodePopup,
		transactions,
	});
	const [popup, setPopup] = useState(null);

	const closePopup = () => {
		setPopup(null);
		onSelect?.(null);
	};

	interactionRef.current.onSelect = onSelect;
	interactionRef.current.enableEdgePopup = enableEdgePopup;
	interactionRef.current.enableNodePopup = enableNodePopup;
	interactionRef.current.transactions = transactions;
	interactionRef.current.openPopup = (event, link) => {
		const tx =
			transactions.find((item) => sameId(item.id, linkTxId(link))) ??
			(link
				? {
						id: linkTxId(link),
						timestamp: link.timestamp,
						amount: link.amount,
						currency: link.currency,
						payment_format: link.payment_format,
						sender: link.sender,
						receiver: link.receiver,
						isCashOut: link.isCashOut,
					}
				: null);
		if (!tx || !containerRef.current) {
			return;
		}
		const { x, y } = clampPopupPosition(containerRef.current, event, 288, 340);
		setPopup({ kind: "tx", txId: linkTxId(link), tx, x, y });
	};
	interactionRef.current.openNodePopup = (event, node, transactionCount) => {
		if (!node || !containerRef.current) {
			return;
		}
		const { x, y } = clampPopupPosition(containerRef.current, event, 288, 200);
		setPopup({
			kind: "node",
			nodeId: node.id,
			node,
			transactionCount,
			x,
			y,
		});
	};

	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return undefined;
		}
		return renderStaticGraph({
			container,
			graphId,
			nodes,
			links,
			isDark,
			detailed,
			cashOutIconUrl: cashOutIcon,
			zoomApiRef,
			highlightApiRef,
			interactionRef,
			selection,
			transactions,
		});
	}, [graphId, nodes, links, isDark, detailed]);

	useEffect(() => {
		highlightApiRef.current?.apply(selection);
		if (selection == null) {
			setPopup(null);
			return;
		}
		setPopup((current) => {
			if (!current) {
				return current;
			}
			if (selection.type === "transaction" && current.kind === "tx" && sameId(current.txId, selection.id)) {
				return current;
			}
			if (selection.type === "node" && current.kind === "node" && sameId(current.nodeId, selection.id)) {
				return current;
			}
			return null;
		});
	}, [selection]);

	useEffect(() => {
		if (!popup) {
			return undefined;
		}
		const onKeyDown = (event) => {
			if (event.key === "Escape") {
				closePopup();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [popup, onSelect]);

	return (
		<div className={`relative ${className}`}>
			<div ref={containerRef} className="h-full w-full" />
			{popup?.kind === "tx" ? (
				<EdgeTransactionPopup tx={popup.tx} x={popup.x} y={popup.y} isDark={isDark} onClose={closePopup} />
			) : null}
			{popup?.kind === "node" ? (
				<NodeAccountPopup
					node={popup.node}
					transactionCount={popup.transactionCount}
					x={popup.x}
					y={popup.y}
					isDark={isDark}
					onClose={closePopup}
				/>
			) : null}
			<div className="absolute right-3 bottom-3 z-10 flex flex-col gap-2">
				{showExpand ? (
					<button
						type="button"
						className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-300 bg-white/95 text-zinc-800 shadow hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-900/95 dark:text-zinc-100 dark:hover:bg-zinc-800"
						aria-label="Zoom in to detailed graph"
						onClick={onExpand}
					>
						<ZoomInIcon />
					</button>
				) : (
					<>
						<button
							type="button"
							className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-300 bg-white/95 text-zinc-800 shadow hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-900/95 dark:text-zinc-100 dark:hover:bg-zinc-800"
							aria-label="Zoom in"
							onClick={() => zoomApiRef.current?.zoomIn()}
						>
							<ZoomInIcon />
						</button>
						<button
							type="button"
							className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-300 bg-white/95 text-zinc-800 shadow hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-900/95 dark:text-zinc-100 dark:hover:bg-zinc-800"
							aria-label="Zoom out"
							onClick={() => zoomApiRef.current?.zoomOut()}
						>
							<ZoomOutIcon />
						</button>
					</>
				)}
			</div>
		</div>
	);
}

export default function MuleNetworkGraph({
	graphId,
	graphName,
	nodes,
	links,
	isDark = false,
	className = "",
	transactions = [],
	selection = null,
	onSelect,
}) {
	const [detailedOpen, setDetailedOpen] = useState(false);
	const [notesOpen, setNotesOpen] = useState(false);
	const [note, setNote] = useState("");
	const [noteError, setNoteError] = useState("");
	const [noteSubmitting, setNoteSubmitting] = useState(false);
	const noteRef = useRef(null);

	useEffect(() => {
		if (!detailedOpen) {
			return undefined;
		}
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		const onKeyDown = (event) => {
			if (event.key === "Escape") {
				setDetailedOpen(false);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [detailedOpen]);

	useEffect(() => {
		if (!isApiConfigured()) {
			return undefined;
		}

		let cancelled = false;
		getGraphNote(graphId)
			.then((saved) => {
				if (!cancelled && saved?.note != null) {
					setNote(saved.note);
				}
			})
			.catch(() => {
				// Keep the notepad usable if the saved note cannot be loaded.
			});

		return () => {
			cancelled = true;
		};
	}, [graphId]);

	useEffect(() => {
		if (notesOpen) {
			noteRef.current?.focus();
		}
	}, [notesOpen]);

	const submitNotes = async () => {
		setNoteError("");
		if (!isApiConfigured()) {
			setNoteError("API is not configured. Set VITE_API_BASE_URL.");
			return;
		}

		setNoteSubmitting(true);
		try {
			const saved = await submitGraphNote(graphId, note);
			if (saved?.note != null) {
				setNote(saved.note);
			}
			setNotesOpen(false);
		} catch (error) {
			setNoteError(getErrorMessage(error));
		} finally {
			setNoteSubmitting(false);
		}
	};

	return (
		<>
			<div
				className={`relative h-[360px] w-full overflow-hidden rounded border border-zinc-300 md:h-[520px] dark:border-zinc-700 ${className}`}
			>
				<button
					type="button"
					className="absolute top-3 right-3 z-10 rounded-md bg-[#86BC24] px-3 py-1.5 text-xs font-semibold text-[#0F0B0B] shadow hover:bg-[#6B9A1C]"
					onClick={() => {
						setNoteError("");
						setNotesOpen(true);
					}}
				>
					Add Notes
				</button>
				{notesOpen ? (
					<div
						role="dialog"
						aria-label="Add notes"
						className="absolute inset-y-0 right-0 z-20 flex w-[min(100%,20rem)] flex-col border-l border-zinc-300 bg-white shadow-xl dark:border-zinc-600 dark:bg-zinc-900"
						onMouseDown={(event) => event.stopPropagation()}
						onClick={(event) => event.stopPropagation()}
					>
						<div className="flex items-center justify-end border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-700">
							<button
								type="button"
								className="flex h-8 w-8 items-center justify-center rounded-full text-2xl leading-none text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
								aria-label="Close notes"
								onClick={() => setNotesOpen(false)}
							>
								×
							</button>
						</div>
						<textarea
							ref={noteRef}
							value={note}
							onChange={(event) => setNote(event.target.value)}
							placeholder="Add a note..."
							className="min-h-0 flex-1 resize-none bg-transparent px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
						/>
						{noteError ? (
							<p className="px-3 pb-2 text-xs text-red-600 dark:text-red-400" role="alert">
								{noteError}
							</p>
						) : null}
						<div className="flex justify-center border-t border-zinc-200 px-3 py-3 dark:border-zinc-700">
							<button
								type="button"
								className="rounded-md bg-[#86BC24] px-5 py-2 text-sm font-semibold text-[#0F0B0B] shadow hover:bg-[#6B9A1C] disabled:opacity-60"
								disabled={noteSubmitting}
								onClick={submitNotes}
							>
								{noteSubmitting ? "Submitting…" : "Submit"}
							</button>
						</div>
					</div>
				) : null}
				<GraphCanvas
					graphId={graphId}
					nodes={nodes}
					links={links}
					isDark={isDark}
					detailed={false}
					showExpand
					onExpand={() => setDetailedOpen(true)}
					className="h-full w-full"
					transactions={transactions}
					selection={selection}
					onSelect={onSelect}
					enableEdgePopup
					enableNodePopup
				/>
			</div>

			{detailedOpen ? (
				<div className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-6">
					<button
						type="button"
						className="absolute inset-0 bg-zinc-950/50 backdrop-blur-md"
						aria-label="Close detailed graph"
						onClick={() => setDetailedOpen(false)}
					/>
					<div
						role="dialog"
						aria-modal="true"
						aria-label="Detailed mule network graph"
						className="relative z-10 flex h-[min(90vh,860px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-950"
					>
						<div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
							<div>
								<h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
									Detailed Graph · {graphName ?? `Graph ${graphId}`}
								</h2>
								<p className="text-xs text-zinc-500 dark:text-zinc-400">
									Scroll to zoom · drag background to pan
								</p>
							</div>
							<button
								type="button"
								className="flex h-11 w-11 items-center justify-center rounded-full text-3xl leading-none text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
								aria-label="Close detailed graph"
								onClick={() => setDetailedOpen(false)}
							>
								×
							</button>
						</div>
						<GraphCanvas
							graphId={graphId}
							nodes={nodes}
							links={links}
							isDark={isDark}
							detailed
							className="min-h-0 flex-1"
						/>
					</div>
				</div>
			) : null}
		</>
	);
}

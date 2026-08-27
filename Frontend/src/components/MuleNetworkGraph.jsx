import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import cashOutIcon from "../assets/cash-out-icon.png";

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
		return { nodes: [...nodeById.values()], links: resolvedLinks };
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
	const usableHeight = Math.max(180, height - marginY * 2);
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

	return { nodes: positioned, links: resolvedLinks };
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

function renderStaticGraph({ container, graphId, nodes, links, isDark, detailed, cashOutIconUrl, zoomApiRef }) {
	const width = container.clientWidth || (detailed ? 960 : 640);
	const height = container.clientHeight || (detailed ? 640 : 380);
	const linkStroke = isDark ? "#a1a1aa" : "#9a9a9a";
	const labelFill = isDark ? "#f4f4f5" : "#18181b";
	const cashOutLabel = "#16a34a";
	const bgFill = isDark ? "#18181b" : "#ececec";
	const userFill = "#111111";
	const markerId = `arrow-${graphId}-${detailed ? "detail" : "simple"}`;

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

	const svg = d3
		.select(container)
		.append("svg")
		.attr("width", "100%")
		.attr("height", "100%")
		.attr("viewBox", `0 0 ${width} ${height}`)
		.attr("role", "img")
		.attr("aria-label", `${detailed ? "Detailed" : "Simplified"} mule network ${graphId}`)
		.style("cursor", "grab");

	svg.append("rect").attr("class", "graph-bg").attr("width", width).attr("height", height).attr("fill", bgFill);

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

	const viewport = svg.append("g").attr("class", "viewport");

	const link = viewport
		.append("g")
		.attr("fill", "none")
		.selectAll("path")
		.data(layout.links)
		.join("path")
		.attr("stroke", linkStroke)
		.attr("stroke-width", 2.2)
		.attr("stroke-opacity", 0.95)
		.attr("marker-end", `url(#${markerId})`)
		.attr("d", linkPath);

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
		.attr("transform", (d) => `translate(${d.x},${d.y})`);

	node.each(function (d) {
		const g = d3.select(this);
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
				.text(d.label ?? d.lastName ?? d.account_number ?? d.id)
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

	const zoom = d3
		.zoom()
		.scaleExtent([0.45, 3.5])
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

	if (zoomApiRef) {
		zoomApiRef.current = {
			zoomIn: () => svg.transition().duration(180).call(zoom.scaleBy, 1.25),
			zoomOut: () => svg.transition().duration(180).call(zoom.scaleBy, 0.8),
		};
	}

	const resizeObserver = new ResizeObserver(() => {
		const nextWidth = container.clientWidth || width;
		const nextHeight = container.clientHeight || height;
		svg.attr("viewBox", `0 0 ${nextWidth} ${nextHeight}`);
		svg.select("rect.graph-bg").attr("width", nextWidth).attr("height", nextHeight);
		const nextLayout = computeLayout(visibleNodes, visibleLinks, nextWidth, nextHeight, detailed);
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
		resizeObserver.disconnect();
		svg.on(".zoom", null);
		svg.remove();
	};
}

function GraphCanvas({ graphId, nodes, links, isDark, detailed, className = "", showExpand = false, onExpand }) {
	const containerRef = useRef(null);
	const zoomApiRef = useRef(null);

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
		});
	}, [graphId, nodes, links, isDark, detailed]);

	return (
		<div className={`relative ${className}`}>
			<div ref={containerRef} className="h-full w-full" />
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

export default function MuleNetworkGraph({ graphId, graphName, nodes, links, risk, isDark = false, className = "" }) {
	const [detailedOpen, setDetailedOpen] = useState(false);

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

	return (
		<>
			<div
				className={`relative h-[360px] w-full overflow-hidden rounded border border-zinc-300 md:h-[520px] dark:border-zinc-700 ${className}`}
			>
				<div className="absolute top-3 right-3 z-10 rounded border border-zinc-300 bg-white/95 px-2.5 py-1 text-xs font-semibold text-zinc-800 shadow dark:border-zinc-600 dark:bg-zinc-900/95 dark:text-zinc-100">
					Risk Score: {risk}%
				</div>
				<GraphCanvas
					graphId={graphId}
					nodes={nodes}
					links={links}
					isDark={isDark}
					detailed={false}
					showExpand
					onExpand={() => setDetailedOpen(true)}
					className="h-full w-full"
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

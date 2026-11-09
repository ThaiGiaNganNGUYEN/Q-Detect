import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import cashOutIcon from "../assets/cash-out-icon.png";
import { getErrorMessage } from "../api/client";
import { getGraphNote, submitGraphNote } from "../api/notes";
import { exportSvgAsPng, toFileSlug } from "../utils/download";
import { linkLabelPoint, linkPath } from "./graph/geometry.js";
import { attachHover, attachNodeDrag } from "./graph/interactions.js";
import { computeLayout } from "./graph/layout.js";

function ExpandIcon({ className = "h-5 w-5" }) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M4 14v6h6" />
			<path d="M20 10V4h-6" />
		</svg>
	);
}

function DownloadIcon({ className = "h-4 w-4" }) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M12 4v11" />
			<path d="M7 10l5 5 5-5" />
			<path d="M5 20h14" />
		</svg>
	);
}

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

function appendUserIcon(selection, { radius = 44, fill = "#0f0b0b", iconFill = "#fff" } = {}) {
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
			className={`absolute z-20 w-72 max-h-[min(340px,calc(100%-16px))] overflow-auto rounded-lg border border-t-[3px] px-3.5 py-3 text-xs shadow-xl ${
				isDark
					? "border-ink-600 border-t-brand bg-ink-800 text-zinc-100"
					: "border-zinc-200 border-t-brand bg-white text-ink"
			}`}
			style={{ left: x, top: y }}
			onMouseDown={(event) => event.stopPropagation()}
			onClick={(event) => event.stopPropagation()}
		>
			<div className="mb-2 flex items-start justify-between gap-2">
				<p className="font-semibold">Transaction details</p>
				<button
					type="button"
					className="flex h-6 w-6 items-center justify-center rounded-md text-base leading-none text-zinc-500 hover:bg-zinc-100 dark:hover:bg-ink-700"
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
			className={`absolute z-20 w-72 max-h-[min(240px,calc(100%-16px))] overflow-auto rounded-lg border border-t-[3px] px-3.5 py-3 text-xs shadow-xl ${
				isDark
					? "border-ink-600 border-t-brand bg-ink-800 text-zinc-100"
					: "border-zinc-200 border-t-brand bg-white text-ink"
			}`}
			style={{ left: x, top: y }}
			onMouseDown={(event) => event.stopPropagation()}
			onClick={(event) => event.stopPropagation()}
		>
			<div className="mb-2 flex items-start justify-between gap-2">
				<p className="font-semibold">Account details</p>
				<button
					type="button"
					className="flex h-6 w-6 items-center justify-center rounded-md text-base leading-none text-zinc-500 hover:bg-zinc-100 dark:hover:bg-ink-700"
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

function viewFit(layoutWidth, layoutHeight, viewWidth, viewHeight, detailed, nodeCount = 0) {
	const insets = detailed
		? { top: 20, right: 68, bottom: 68, left: 20 }
		: { top: 52, right: 24, bottom: 60, left: 20 };
	const availW = Math.max(48, viewWidth - insets.left - insets.right);
	const availH = Math.max(48, viewHeight - insets.top - insets.bottom);
	const scale = Math.min(availW / Math.max(layoutWidth, 1), availH / Math.max(layoutHeight, 1));
	const cap = detailed ? 1.15 : 1.45;
	const floor = nodeCount > 120 ? (detailed ? 0.48 : 0.62) : 0;
	const k = Math.min(Math.max(scale, floor), cap);
	return d3.zoomIdentity
		.translate(insets.left + (availW - layoutWidth * k) / 2, insets.top + (availH - layoutHeight * k) / 2)
		.scale(k);
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
	const highlightStroke = isDark ? "#86bc24" : "#6f9e1a";
	const labelFill = isDark ? "#f4f4f5" : "#0f0b0b";
	const cashOutLabel = "#26890d";
	const selfTransferStroke = "#52525b";
	const bgFill = isDark ? "#171212" : "#ffffff";
	const userFill = isDark ? "#3d3636" : "#0f0b0b";
	const markerId = `arrow-${graphId}-${detailed ? "detail" : "simple"}`;
	const highlightMarkerId = `${markerId}-hi`;

	const visibleNodes = detailed ? nodes : nodes.filter((node) => node.kind === "account");
	const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
	const visibleLinks = detailed
		? links
		: links.filter((link) => {
				const sourceId = typeof link.source === "object" ? link.source.id : link.source;
				const targetId = typeof link.target === "object" ? link.target.id : link.target;
				return !link.isSelfPayment && visibleNodeIds.has(sourceId) && visibleNodeIds.has(targetId);
			});

	const layout = computeLayout(visibleNodes, visibleLinks, width, height, detailed);
	const graphInteractive = Boolean(interactionRef?.current?.onSelect);

	const svg = d3
		.select(container)
		.append("svg")
		.attr("width", "100%")
		.attr("height", "100%")
		.attr("viewBox", `0 0 ${width} ${height}`)
		.attr("role", "application")
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
		.attr("stroke-width", layout.natural ? 1.4 : 2.2)
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
				.data(layout.links.filter((link) => link.labelAt))
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
		.attr("role", "button")
		.attr("aria-label", (d) => d.account_number || d.label || String(d.id))
		.attr("transform", (d) => `translate(${d.x},${d.y})`)
		.style("cursor", "grab");

	node.each(function (d) {
		const g = d3.select(this);
		if (d.hub) {
			g.append("circle")
				.attr("r", (d.r ?? 20) + 7)
				.attr("fill", highlightStroke)
				.attr("fill-opacity", isDark ? 0.16 : 0.12)
				.attr("stroke", highlightStroke)
				.attr("stroke-opacity", 0.85)
				.attr("stroke-width", 2)
				.attr("pointer-events", "none");
		}
		g.append("circle")
			.attr("class", "node-highlight-ring")
			.attr("r", (d.r ?? 44) + (d.hub ? 12 : 7))
			.attr("fill", "none")
			.attr("stroke", highlightStroke)
			.attr("stroke-width", 3.5)
			.attr("opacity", 0)
			.attr("pointer-events", "none");
		if (d.kind === "cashout") {
			const radius = d.r ?? (detailed ? 42 : 38);
			const isCashOutNode = d.label === "Cash-Out";
			const nodeStroke = isCashOutNode ? cashOutLabel : selfTransferStroke;
			g.append("circle").attr("r", radius).attr("fill", "#ffffff").attr("stroke", nodeStroke).attr("stroke-width", 3);
			if (isCashOutNode) {
				const iconSize = radius * 1.55;
				const clipId = `cashout-clip-${graphId}-${detailed ? "d" : "s"}-${String(d.id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
				defs.append("clipPath").attr("id", clipId).append("circle").attr("r", radius);
				g.append("image")
					.attr("href", cashOutIconUrl)
					.attr("x", -iconSize / 2)
					.attr("y", -iconSize / 2)
					.attr("width", iconSize)
					.attr("height", iconSize)
					.attr("clip-path", `url(#${clipId})`);
			} else {
				// Circular arrow: money that came back to the same account.
				g.append("path")
					.attr("d", "M-11 -8V-2H-5M-8.49 3a9 9 0 1 0 2.13-9.36L-11 -2")
					.attr("transform", `scale(${radius / 18})`)
					.attr("fill", "none")
					.attr("stroke", nodeStroke)
					.attr("stroke-width", 2)
					.attr("stroke-linecap", "round")
					.attr("stroke-linejoin", "round")
					.attr("pointer-events", "none");
			}
			g.append("circle").attr("r", radius).attr("fill", "none").attr("stroke", nodeStroke).attr("stroke-width", 3).attr("pointer-events", "none");
			g.append("text")
				.text(d.label)
				.attr("x", 0)
				.attr("y", radius + 18)
				.attr("text-anchor", "middle")
				.attr("fill", isCashOutNode ? cashOutLabel : labelFill)
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
				.attr("x", d.labelDx ?? 0)
				.attr("y", d.labelDy ?? -(d.r ?? 48) - 12)
				.attr("text-anchor", d.labelAnchor || "middle")
				.attr("fill", labelFill)
				.attr("stroke", bgFill)
				.attr("stroke-width", 4)
				.attr("paint-order", "stroke")
				.attr("font-size", d.fontSize || "15px")
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
				[tx.sender?.id, tx.isSelfPayment ? `cashout-${tx.sender?.id}` : tx.receiver?.id].filter(Boolean).map(String),
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

	let currentSelection = selection;
	const applyHighlight = (nextSelection) => {
		currentSelection = nextSelection;
		const highlight =
			nextSelection?.type === "node"
				? resolveNodeHighlight(nextSelection.id)
				: resolveTxHighlight(nextSelection?.type === "transaction" ? nextSelection.id : nextSelection);
		const txHighlighted = (d) => Boolean(highlight?.txIds?.has(String(linkTxId(d))));
		link
			.attr("stroke", (d) => (txHighlighted(d) ? highlightStroke : linkStroke))
			.attr("stroke-width", (d) => (txHighlighted(d) ? 3.2 : layout.natural ? 1.4 : 2.2))
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

	let userAdjusted = false;
	let userDragged = false;

	attachNodeDrag({
		node,
		link,
		linkHit,
		linkLabel,
		links: layout.links,
		nodes: layout.nodes,
		onDrag: () => {
			userDragged = true;
		},
	});
	attachHover({
		node,
		link,
		links: layout.links,
		applyHighlight,
		getSelection: () => currentSelection,
	});

	const applyPresentation = (viewWidth, viewHeight) => {
		container.style.overflow = "hidden";
		svg.attr("width", "100%").attr("height", "100%").attr("viewBox", `0 0 ${viewWidth} ${viewHeight}`);
		if (layout.natural) {
			svg.call(zoom.transform, viewFit(layout.width, layout.height, viewWidth, viewHeight, detailed, layout.nodes.length));
		}
	};

	const zoom = d3
		.zoom()
		.scaleExtent([0.02, 6])
		.filter((event) => {
			if (event.type === "wheel") {
				return true;
			}
			if (event.button) {
				return false;
			}
			const target = event.target;
			if (typeof target.closest === "function" && target.closest(".node-hit")) {
				return false;
			}
			if (graphInteractive && target.classList?.contains("edge-hit")) {
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
			if (event.sourceEvent) {
				userAdjusted = true;
			}
		});

	svg.call(zoom);
	svg.on("dblclick.zoom", null);
	applyPresentation(width, height);

	if (graphInteractive) {
		linkHit.on("click", (event, d) => {
			if (event.defaultPrevented) {
				return;
			}
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
			if (event.defaultPrevented) {
				return;
			}
			event.stopPropagation();
			if (d.kind === "cashout") {
				return;
			}
			const nextSelection = { type: "node", id: d.id };
			applyHighlight(nextSelection);
			interactionRef?.current?.onSelect?.(nextSelection);
			if (interactionRef?.current?.enableNodePopup) {
				// All of the account's transactions, including lines this view hides.
				const transactionCount = links.filter((item) => linkTouchesNode(item, d.id)).length;
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
		if (nextWidth < 2 || nextHeight < 2) {
			return;
		}
		if (layout.natural) {
			if (!userAdjusted) {
				applyPresentation(nextWidth, nextHeight);
			}
			return;
		}
		svg.attr("viewBox", `0 0 ${nextWidth} ${nextHeight}`);
		if (userDragged) {
			return;
		}
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
						className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white/95 text-ink shadow-sm backdrop-blur transition-colors hover:border-brand hover:text-brand-700 dark:border-ink-600 dark:bg-ink-800/95 dark:text-zinc-100 dark:hover:border-brand dark:hover:text-brand"
						aria-label="Open detailed graph"
						title="Open detailed graph"
						onClick={onExpand}
					>
						<ExpandIcon />
					</button>
				) : (
					<>
						<button
							type="button"
							className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white/95 text-ink shadow-sm backdrop-blur transition-colors hover:border-brand hover:text-brand-700 dark:border-ink-600 dark:bg-ink-800/95 dark:text-zinc-100 dark:hover:border-brand dark:hover:text-brand"
							aria-label="Zoom in"
							onClick={() => zoomApiRef.current?.zoomIn()}
						>
							<ZoomInIcon />
						</button>
						<button
							type="button"
							className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white/95 text-ink shadow-sm backdrop-blur transition-colors hover:border-brand hover:text-brand-700 dark:border-ink-600 dark:bg-ink-800/95 dark:text-zinc-100 dark:hover:border-brand dark:hover:text-brand"
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
	live = false,
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
	const detailedGraphRef = useRef(null);
	const [exporting, setExporting] = useState(false);
	const [exportError, setExportError] = useState("");

	const exportDetailedPng = async () => {
		const svg = detailedGraphRef.current?.querySelector("svg");
		if (!svg) {
			return;
		}
		setExportError("");
		setExporting(true);
		try {
			await exportSvgAsPng(svg, `${toFileSlug(graphName ?? `graph-${graphId}`)}-detailed-graph.png`, {
				background: isDark ? "#171212" : "#ffffff",
				fitSelector: "g.viewport",
			});
		} catch (error) {
			setExportError(getErrorMessage(error));
		} finally {
			setExporting(false);
		}
	};

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
		if (!live) {
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
	}, [graphId, live]);

	useEffect(() => {
		if (notesOpen) {
			noteRef.current?.focus();
		}
	}, [notesOpen]);

	const submitNotes = async () => {
		setNoteError("");
		if (!live) {
			setNoteError("This is sample data, so the note can't be saved.");
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
				className={`relative h-[380px] w-full overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm md:h-[540px] dark:border-ink-700 dark:bg-ink-900 ${className}`}
			>
				<div className="pointer-events-none absolute top-3 left-4 z-10">
					<p className="text-sm font-bold">Network graph</p>
				</div>
				<button
					type="button"
					className="btn-primary absolute top-3 right-3 z-10 gap-1.5 px-3 py-1.5 text-xs shadow-sm"
					onClick={() => {
						setNoteError("");
						setNotesOpen(true);
					}}
				>
					<svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
						<path d="M13.6 2.6a2 2 0 0 1 2.8 2.8l-8.7 8.7-3.7.9.9-3.7 8.7-8.7zM3 17h14v1.5H3z" />
					</svg>
					Add Notes
				</button>
				{notesOpen ? (
					<div
						role="dialog"
						aria-label="Add notes"
						className="absolute inset-y-0 right-0 z-20 flex w-[min(100%,22rem)] flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-ink-600 dark:bg-ink-800"
						onMouseDown={(event) => event.stopPropagation()}
						onClick={(event) => event.stopPropagation()}
					>
						<div className="flex items-center justify-between border-b-2 border-brand bg-ink px-4 py-2.5 text-white">
							<div>
								<p className="text-sm font-bold">Case notes</p>
								<p className="text-[11px] text-zinc-400">{graphName ?? `Graph ${graphId}`}</p>
							</div>
							<button
								type="button"
								className="flex h-8 w-8 items-center justify-center rounded-lg text-2xl leading-none text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
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
							className="m-3 min-h-0 flex-1 resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm leading-relaxed text-ink outline-none placeholder:text-zinc-400 focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/30 dark:border-ink-600 dark:bg-ink-900 dark:text-zinc-100 dark:focus:bg-ink-900"
						/>
						{noteError ? (
							<p className="px-3 pb-2 text-xs text-red-600 dark:text-red-400" role="alert">
								{noteError}
							</p>
						) : null}
						<div className="flex justify-center border-t border-zinc-200 px-3 py-3 dark:border-ink-600">
							<button
								type="button"
								className="btn-primary px-8"
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
						className="absolute inset-0 bg-ink/60 backdrop-blur-sm"
						aria-label="Close detailed graph"
						onClick={() => setDetailedOpen(false)}
					/>
					<div
						role="dialog"
						aria-modal="true"
						aria-label="Detailed mule network graph"
						className="relative z-10 flex h-[min(90vh,860px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-ink-700 dark:bg-ink-900"
					>
						<div className="flex items-center justify-between border-b-2 border-brand bg-ink px-5 py-3 text-white">
							<h2 className="text-lg font-bold tracking-tight">
								Detailed Graph · {graphName ?? `Graph ${graphId}`}
							</h2>
							<div className="flex items-center gap-2">
								{exportError ? (
									<p className="text-xs text-red-300" role="alert">
										{exportError}
									</p>
								) : null}
								<button
									type="button"
									className="btn-primary px-3 py-1.5"
									disabled={exporting}
									onClick={exportDetailedPng}
								>
									<DownloadIcon />
									{exporting ? "Exporting…" : "Export PNG"}
								</button>
								<button
									type="button"
									className="flex h-10 w-10 items-center justify-center rounded-lg text-3xl leading-none text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
									aria-label="Close detailed graph"
									onClick={() => setDetailedOpen(false)}
								>
									×
								</button>
							</div>
						</div>
						<div ref={detailedGraphRef} className="flex min-h-0 flex-1 flex-col">
							<GraphCanvas
								graphId={graphId}
								nodes={nodes}
								links={links}
								isDark={isDark}
								detailed
								className="min-h-0 flex-1"
								transactions={transactions}
								selection={selection}
								onSelect={onSelect}
								enableEdgePopup
								enableNodePopup
							/>
						</div>
					</div>
				</div>
			) : null}
		</>
	);
}


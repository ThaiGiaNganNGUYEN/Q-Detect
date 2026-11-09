import * as d3 from "d3";
import { curvePoint, routedSpoke } from "./geometry.js";

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
		return { nodes: [...nodeById.values()], links: resolvedLinks, width, height, natural: false };
	}
	return computeNetworkLayout(nodes, links, detailed);
}

function linkEndpointId(end) {
	return typeof end === "object" && end ? end.id : end;
}

function undirectedComponents(ids, neighbors) {
	const seen = new Set();
	const components = [];
	for (const id of ids) {
		if (seen.has(id)) {
			continue;
		}
		const component = [];
		const queue = [id];
		seen.add(id);
		while (queue.length > 0) {
			const current = queue.pop();
			component.push(current);
			for (const next of neighbors.get(current) || []) {
				if (!seen.has(next)) {
					seen.add(next);
					queue.push(next);
				}
			}
		}
		components.push(component);
	}
	return components;
}

function nearestHub(start, neighbors, hubSet) {
	const seen = new Set([start]);
	const queue = [start];
	while (queue.length > 0) {
		const current = queue.shift();
		for (const next of neighbors.get(current) || []) {
			if (hubSet.has(next)) {
				return next;
			}
			if (!seen.has(next)) {
				seen.add(next);
				queue.push(next);
			}
		}
	}
	return null;
}

function layoutPath(ids, neighbors, nodeById, spacing) {
	const start = ids.find((id) => (neighbors.get(id) || []).length <= 1) || ids[0];
	const ordered = [];
	const seen = new Set();
	let current = start;
	while (current && !seen.has(current)) {
		ordered.push(current);
		seen.add(current);
		current = (neighbors.get(current) || []).find((next) => !seen.has(next));
	}
	for (const id of ids) {
		if (!seen.has(id)) {
			ordered.push(id);
		}
	}
	const cycle = ids.length > 2 && ids.every((id) => (neighbors.get(id) || []).length === 2);
	if (cycle || ordered.length > 6) {
		const columns = cycle ? ordered.length : Math.max(3, Math.round(Math.sqrt(ordered.length * 1.55)));
		const pitch = ordered.length > 24 ? Math.max(36, spacing * 0.62) : spacing;
		if (cycle) {
			const ring = (ordered.length * pitch) / (2 * Math.PI);
			ordered.forEach((id, index) => {
				const angle = (index / ordered.length) * Math.PI * 2 - Math.PI / 2;
				const node = nodeById.get(id);
				node.x = Math.cos(angle) * ring;
				node.y = Math.sin(angle) * ring;
				node.angle = angle;
			});
			return;
		}
		ordered.forEach((id, index) => {
			const row = Math.floor(index / columns);
			const column = index % columns;
			const xIndex = row % 2 === 0 ? column : columns - 1 - column;
			const node = nodeById.get(id);
			node.x = xIndex * pitch;
			node.y = row * pitch * 0.86;
			node.angle = row % 2 === 0 ? 0 : Math.PI;
		});
		return;
	}
	ordered.forEach((id, index) => {
		const node = nodeById.get(id);
		node.x = index * spacing;
		node.y = 0;
		node.angle = index === 0 ? Math.PI : 0;
	});
}

function layoutStarComponent(ids, neighbors, degree, nodeById, detailed) {
	const maxDegree = Math.max(0, ...ids.map((id) => degree.get(id) || 0));
	if (maxDegree <= 2) {
		layoutPath(ids, neighbors, nodeById, detailed ? 118 : 78);
		return;
	}

	let hubs = ids.filter((id) => (degree.get(id) || 0) >= 3);
	if (hubs.length === 0) {
		hubs = [ids.reduce((best, id) => ((degree.get(id) || 0) > (degree.get(best) || 0) ? id : best))];
	}
	if (hubs.length > Math.max(3, ids.length * 0.35)) {
		hubs = [...hubs]
			.sort((a, b) => (degree.get(b) || 0) - (degree.get(a) || 0) || String(a).localeCompare(String(b)))
			.slice(0, Math.max(1, Math.round(Math.sqrt(ids.length))));
	}
	const hubSet = new Set(hubs);
	const satellites = new Map(hubs.map((id) => [id, []]));
	for (const id of ids) {
		if (hubSet.has(id)) {
			continue;
		}
		const linked = (neighbors.get(id) || [])
			.filter((next) => hubSet.has(next))
			.sort((a, b) => (degree.get(b) || 0) - (degree.get(a) || 0));
		const hub = linked[0] || nearestHub(id, neighbors, hubSet) || hubs[0];
		satellites.get(hub).push(id);
	}

	const ring = new Map();
	for (const hub of hubs) {
		const sats = satellites.get(hub);
		const satRadius = Math.max(12, ...sats.map((id) => nodeById.get(id).r), 0);
		const step = satRadius * 2 + (detailed ? 28 : 20);
		const span = hubs.length > 2 ? Math.PI * 0.85 : hubs.length > 1 ? Math.PI * 1.35 : Math.PI * 2;
		const needed = sats.length > 1 ? ((sats.length - 1) * step) / span : 0;
		ring.set(hub, Math.max(nodeById.get(hub).r + satRadius + (detailed ? 58 : 42), needed));
	}

	const orderedHubs = [...hubs].sort(
		(a, b) => (degree.get(b) || 0) - (degree.get(a) || 0) || ring.get(b) - ring.get(a),
	);
	const primary = nodeById.get(orderedHubs[0]);
	primary.x = 0;
	primary.y = 0;
	primary.angle = -Math.PI / 2;
	const pad = detailed ? 110 : 84;
	if (orderedHubs.length === 2) {
		const hub = orderedHubs[1];
		const node = nodeById.get(hub);
		const dist = ring.get(orderedHubs[0]) + ring.get(hub) + pad;
		node.x = dist;
		node.y = 0;
		node.angle = 0;
	} else if (orderedHubs.length > 2) {
		const count = orderedHubs.length;
		let orbit = 0;
		for (let index = 0; index < count; index += 1) {
			const a = orderedHubs[index];
			const b = orderedHubs[(index + 1) % count];
			const chord = ring.get(a) + ring.get(b) + pad;
			orbit = Math.max(orbit, chord / (2 * Math.sin(Math.PI / count)));
		}
		orderedHubs.forEach((hub, index) => {
			const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
			const node = nodeById.get(hub);
			node.x = Math.cos(angle) * orbit;
			node.y = Math.sin(angle) * orbit;
			node.angle = angle;
		});
	}

	const hubOf = new Map();
	for (const hub of orderedHubs) {
		hubOf.set(hub, hub);
		for (const id of satellites.get(hub)) {
			hubOf.set(id, hub);
		}
	}
	for (const hub of orderedHubs) {
		placeSatellites(hub, satellites.get(hub), neighbors, orderedHubs, hubOf, nodeById, detailed);
	}

	const placedIds = [...hubOf.keys()];
	const placedNodes = placedIds.map((id) => nodeById.get(id));
	const edges = [];
	const seenEdges = new Set();
	for (const id of placedIds) {
		for (const next of neighbors.get(id) || []) {
			if (!hubOf.has(next)) {
				continue;
			}
			const key = String(id) < String(next) ? `${id}|${next}` : `${next}|${id}`;
			if (seenEdges.has(key)) {
				continue;
			}
			seenEdges.add(key);
			edges.push([nodeById.get(id), nodeById.get(next)]);
		}
	}
	untangle(placedNodes, edges);
	for (const hub of orderedHubs) {
		const hubNode = nodeById.get(hub);
		for (const id of satellites.get(hub)) {
			const node = nodeById.get(id);
			node.angle = Math.atan2(node.y - hubNode.y, node.x - hubNode.x);
		}
	}
}

function satelliteEdges(ids, neighbors) {
	const member = new Set(ids);
	const edges = [];
	const seen = new Set();
	for (const id of ids) {
		for (const next of neighbors.get(id) || []) {
			if (!member.has(next) || String(id) >= String(next)) {
				continue;
			}
			const key = `${id}|${next}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			edges.push([id, next]);
		}
	}
	return edges;
}

function orderCost(order, edges) {
	const index = new Map(order.map((id, position) => [id, position]));
	const count = order.length;
	let spokeCuts = 0;
	let chordCuts = 0;
	for (let i = 0; i < edges.length; i += 1) {
		const a = index.get(edges[i][0]);
		const b = index.get(edges[i][1]);
		if (a == null || b == null) {
			continue;
		}
		const span = Math.min(Math.abs(a - b), count - Math.abs(a - b));
		if (span > 1) {
			spokeCuts += span - 1;
		}
		for (let j = i + 1; j < edges.length; j += 1) {
			const c = index.get(edges[j][0]);
			const d = index.get(edges[j][1]);
			if (c == null || d == null || new Set([a, b, c, d]).size < 4) {
				continue;
			}
			const seq = [a, b, c, d]
				.sort((left, right) => left - right)
				.map((value) => (value === a || value === b ? "0" : "1"))
				.join("");
			if (seq === "0101" || seq === "1010") {
				chordCuts += 1;
			}
		}
	}
	return spokeCuts * 10 + chordCuts;
}

function orderForShortEdges(ids, neighbors) {
	if (ids.length <= 2) {
		return [...ids];
	}
	const member = new Set(ids);
	const linksOf = (id) => (neighbors.get(id) || []).filter((next) => member.has(next));
	const remaining = new Set(ids);
	const start = [...ids].sort(
		(a, b) => linksOf(b).length - linksOf(a).length || String(a).localeCompare(String(b)),
	)[0];
	const ordered = [start];
	remaining.delete(start);
	while (remaining.size > 0) {
		const tail = ordered[ordered.length - 1];
		const adjacent = [...remaining]
			.filter((id) => linksOf(tail).includes(id))
			.sort((a, b) => linksOf(b).length - linksOf(a).length || String(a).localeCompare(String(b)));
		let next = adjacent[0];
		if (!next) {
			next = [...remaining].sort((a, b) => {
				const score = (id) => linksOf(id).filter((other) => ordered.includes(other)).length;
				return score(b) - score(a) || String(a).localeCompare(String(b));
			})[0];
		}
		ordered.push(next);
		remaining.delete(next);
	}

	const edges = satelliteEdges(ids, neighbors);
	if (edges.length === 0) {
		return ordered;
	}
	let best = ordered;
	let bestCost = orderCost(best, edges);
	for (let pass = 0; pass < 8 && bestCost > 0; pass += 1) {
		let improved = false;
		for (let i = 0; i < best.length; i += 1) {
			for (let j = i + 1; j < best.length; j += 1) {
				const candidate = best.slice();
				const swap = candidate[i];
				candidate[i] = candidate[j];
				candidate[j] = swap;
				const cost = orderCost(candidate, edges);
				if (cost < bestCost) {
					best = candidate;
					bestCost = cost;
					improved = true;
				}
			}
		}
		if (!improved) {
			break;
		}
	}
	return best;
}

function openArc(hubNode, orderedHubs, nodeById) {
	const angles = [];
	for (const other of orderedHubs) {
		const otherNode = nodeById.get(other);
		if (!otherNode || otherNode === hubNode || otherNode.x == null) {
			continue;
		}
		angles.push(Math.atan2(otherNode.y - hubNode.y, otherNode.x - hubNode.x));
	}
	if (angles.length === 0) {
		return { start: -Math.PI / 2, span: Math.PI * 2, center: -Math.PI / 2 };
	}
	if (angles.length === 1) {
		const span = Math.PI * 1.35;
		const center = angles[0] + Math.PI;
		return { start: center - span / 2, span, center };
	}
	angles.sort((a, b) => a - b);
	let bestGap = 0;
	let bestAt = angles[0];
	for (let index = 0; index < angles.length; index += 1) {
		const from = angles[index];
		const to = index === angles.length - 1 ? angles[0] + Math.PI * 2 : angles[index + 1];
		const gap = to - from;
		if (gap > bestGap) {
			bestGap = gap;
			bestAt = from;
		}
	}
	const inset = 0.45;
	const span = Math.max(Math.PI * 0.85, Math.min(Math.PI * 1.5, bestGap - inset * 2));
	const center = bestAt + bestGap / 2;
	return { start: center - span / 2, span, center };
}

function placeSatellites(hub, sats, neighbors, orderedHubs, hubOf, nodeById, detailed) {
	if (sats.length === 0) {
		return;
	}
	const hubNode = nodeById.get(hub);
	const locals = [];
	const bridgeGroups = new Map();
	for (const id of sats) {
		const targets = [];
		for (const next of neighbors.get(id) || []) {
			if (next === hub) {
				continue;
			}
			const owner = hubOf.get(next);
			if (owner != null && owner !== hub) {
				targets.push(owner);
			}
		}
		if (targets.length === 0) {
			locals.push(id);
			continue;
		}
		targets.sort((a, b) => {
			const aNode = nodeById.get(a);
			const bNode = nodeById.get(b);
			const aDist = Math.hypot(aNode.x - hubNode.x, aNode.y - hubNode.y);
			const bDist = Math.hypot(bNode.x - hubNode.x, bNode.y - hubNode.y);
			return aDist - bDist;
		});
		const group = bridgeGroups.get(targets[0]) ?? [];
		group.push(id);
		bridgeGroups.set(targets[0], group);
	}

	const satRadius = Math.max(12, ...sats.map((id) => nodeById.get(id).r), 0);
	const step = satRadius * 2 + (detailed ? 28 : 20);
	const orderedLocals = orderForShortEdges(locals, neighbors);
	const open = openArc(hubNode, orderedHubs, nodeById);
	const span = open.span;
	const needed = orderedLocals.length > 1 ? ((orderedLocals.length - 1) * step) / span : 0;
	const radius = Math.max(hubNode.r + satRadius + (detailed ? 58 : 42), needed);

	orderedLocals.forEach((id, index) => {
		let angle;
		if (orderedLocals.length === 1) {
			angle = open.center;
		} else if (span >= Math.PI * 1.99) {
			angle = open.center + (index / orderedLocals.length) * Math.PI * 2;
		} else {
			angle = open.start + (index / (orderedLocals.length - 1)) * span;
		}
		const node = nodeById.get(id);
		node.x = hubNode.x + Math.cos(angle) * radius;
		node.y = hubNode.y + Math.sin(angle) * radius;
		node.angle = angle;
	});

	const bridgeDistance = radius + satRadius + (detailed ? 36 : 26);
	for (const [other, ids] of bridgeGroups) {
		const otherNode = nodeById.get(other);
		const along = Math.atan2(otherNode.y - hubNode.y, otherNode.x - hubNode.x);
		const orderedBridges = orderForShortEdges(ids, neighbors);
		orderedBridges.forEach((id, index) => {
			const side = (index - (orderedBridges.length - 1) / 2) * step;
			const node = nodeById.get(id);
			node.x = hubNode.x + Math.cos(along) * bridgeDistance + Math.cos(along + Math.PI / 2) * side;
			node.y = hubNode.y + Math.sin(along) * bridgeDistance + Math.sin(along + Math.PI / 2) * side;
			node.angle = along;
		});
	}
}

function closestPointOnSegment(px, py, ax, ay, bx, by) {
	const dx = bx - ax;
	const dy = by - ay;
	const len2 = dx * dx + dy * dy || 1;
	const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
	return { x: ax + dx * t, y: ay + dy * t };
}

function untangle(nodes, edges) {
	const movable = nodes.filter((node) => !node.hub);
	for (let step = 0; step < 36; step += 1) {
		for (const node of movable) {
			let fx = 0;
			let fy = 0;
			for (const other of nodes) {
				if (other === node) {
					continue;
				}
				const dx = node.x - other.x;
				const dy = node.y - other.y;
				const dist = Math.hypot(dx, dy) || 0.01;
				const need = (node.r || 12) + (other.r || 12) + 8;
				if (dist < need) {
					fx += (dx / dist) * (need - dist);
					fy += (dy / dist) * (need - dist);
				}
			}
			for (const [a, b] of edges) {
				if (a === node || b === node) {
					continue;
				}
				const closest = closestPointOnSegment(node.x, node.y, a.x, a.y, b.x, b.y);
				const dx = node.x - closest.x;
				const dy = node.y - closest.y;
				const dist = Math.hypot(dx, dy) || 0.01;
				const need = (node.r || 12) + 14;
				if (dist < need) {
					fx += (dx / dist) * (need - dist);
					fy += (dy / dist) * (need - dist);
				}
			}
			node.x += fx * 0.45;
			node.y += fy * 0.45;
		}
	}
}

function placeCashouts(accountIds, links, nodeById, detailed) {
	const member = new Set(accountIds);
	const placed = [];
	for (const link of links) {
		if (!link.isSelfPayment) {
			continue;
		}
		const sourceId = linkEndpointId(link.source);
		const targetId = linkEndpointId(link.target);
		if (!member.has(sourceId)) {
			continue;
		}
		const source = nodeById.get(sourceId);
		const target = nodeById.get(targetId);
		if (!source || !target || target.x != null) {
			continue;
		}
		const angle = source.hub ? Math.PI / 2 : (source.angle ?? 0);
		const dist = source.r + target.r + (detailed ? 28 : 20);
		target.x = source.x + Math.cos(angle) * dist;
		target.y = source.y + Math.sin(angle) * dist;
		target.angle = angle;
		placed.push(targetId);
	}
	return placed;
}

function assignLabelOffsets(node) {
	const angle = node.hub ? -Math.PI / 2 : (node.angle ?? -Math.PI / 2);
	const dist = node.r + 13;
	node.labelDx = Math.cos(angle) * dist;
	node.labelDy = Math.sin(angle) * dist + 4;
	const cos = Math.cos(angle);
	node.labelAnchor = cos > 0.35 ? "start" : cos < -0.35 ? "end" : "middle";
	node.fontSize = "11px";
}

function placeSpokeLabels(links) {
	const placed = [];
	for (const link of links) {
		if (!link.curve) {
			continue;
		}
		const sourceDegree = link.source.degree || 0;
		const targetDegree = link.target.degree || 0;
		if (sourceDegree > 4 && targetDegree > 4) {
			continue;
		}
		const towardTarget = sourceDegree >= targetDegree;
		link.labelT = towardTarget ? 0.78 : 0.22;
		const point = curvePoint(link.curve, link.labelT);
		const hitsLabel = placed.some((other) => Math.hypot(other.x - point.x, other.y - point.y) < 54);
		const hitsNode = [link.source, link.target].some((node) => {
			const labelX = node.x + (node.labelDx || 0);
			const labelY = node.y + (node.labelDy || 0);
			return Math.hypot(node.x - point.x, node.y - point.y) < (node.r || 16) + 16
				|| Math.hypot(labelX - point.x, labelY - point.y) < 42;
		});
		if (hitsLabel || hitsNode) {
			continue;
		}
		link.labelAt = point;
		placed.push(point);
	}
}

function frameLayout(positioned, resolvedLinks, detailed) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const grow = (x, y, halfW, halfH) => {
		minX = Math.min(minX, x - halfW);
		maxX = Math.max(maxX, x + halfW);
		minY = Math.min(minY, y - halfH);
		maxY = Math.max(maxY, y + halfH);
	};

	for (const node of positioned) {
		const radius = node.r ?? 16;
		grow(node.x, node.y, radius + 6, radius + 6);
		if (detailed && node.labelDx != null) {
			grow(node.x + node.labelDx, node.y + node.labelDy, 78, 12);
		}
		if (node.kind === "cashout") {
			grow(node.x, node.y + radius + 16, 40, 8);
		}
	}
	for (const link of resolvedLinks) {
		if (link.labelAt) {
			grow(link.labelAt.x, link.labelAt.y, 70, 16);
		}
	}

	if (!Number.isFinite(minX)) {
		return { width: 320, height: 240 };
	}

	const pad = detailed ? 28 : 20;
	const dx = pad - minX;
	const dy = pad - minY;
	const shift = (point) => {
		point.x += dx;
		point.y += dy;
	};
	for (const node of positioned) {
		shift(node);
	}
	for (const link of resolvedLinks) {
		if (link.curve) {
			shift(link.curve.start);
			shift(link.curve.c1);
			shift(link.curve.c2);
			shift(link.curve.end);
		}
		if (link.labelAt) {
			shift(link.labelAt);
		}
	}
	return {
		width: Math.max(180, maxX - minX + pad * 2),
		height: Math.max(180, maxY - minY + pad * 2),
	};
}

function computeNetworkLayout(nodes, links, detailed) {
	const nodeById = new Map(nodes.map((node) => [node.id, { ...node }]));
	const accounts = nodes.filter((node) => node.kind !== "cashout").map((node) => node.id);
	const neighbors = new Map(accounts.map((id) => [id, []]));
	const degree = new Map(accounts.map((id) => [id, 0]));

	for (const link of links) {
		if (link.isSelfPayment) {
			continue;
		}
		const sourceId = linkEndpointId(link.source);
		const targetId = linkEndpointId(link.target);
		if (!neighbors.has(sourceId) || !neighbors.has(targetId) || sourceId === targetId) {
			continue;
		}
		if (!neighbors.get(sourceId).includes(targetId)) {
			neighbors.get(sourceId).push(targetId);
			neighbors.get(targetId).push(sourceId);
			degree.set(sourceId, (degree.get(sourceId) || 0) + 1);
			degree.set(targetId, (degree.get(targetId) || 0) + 1);
		}
	}

	const maxDegree = Math.max(1, ...degree.values(), 0);
	for (const [id, node] of nodeById) {
		if (node.kind === "cashout") {
			node.r = detailed ? 16 : 14;
			node.hub = false;
			node.degree = 0;
			continue;
		}
		const count = degree.get(id) || 0;
		const weight = count / maxDegree;
		const minRadius = detailed ? 14 : 12;
		const maxRadius = detailed ? 40 : 34;
		const emphasis = count >= 3 ? 0.58 + 0.42 * weight : Math.min(0.22, count * 0.1);
		node.r = minRadius + (maxRadius - minRadius) * Math.min(1, emphasis);
		node.hub = count >= 3;
		node.degree = count;
	}

	const components = undirectedComponents(accounts, neighbors);
	const boxes = [];
	components.forEach((component, index) => {
		layoutStarComponent(component, neighbors, degree, nodeById, detailed);
		const cashouts = placeCashouts(component, links, nodeById, detailed);
		const placed = [...component, ...cashouts].map((id) => nodeById.get(id)).filter((node) => node?.x != null);
		if (placed.length > 1 && placed.length <= 4 && !placed.some((node) => node.hub)) {
			const turn = index * 2.399963229728653;
			let cx = 0;
			let cy = 0;
			for (const node of placed) {
				cx += node.x;
				cy += node.y;
			}
			cx /= placed.length;
			cy /= placed.length;
			const cos = Math.cos(turn);
			const sin = Math.sin(turn);
			for (const node of placed) {
				const dx = node.x - cx;
				const dy = node.y - cy;
				node.x = cx + dx * cos - dy * sin;
				node.y = cy + dx * sin + dy * cos;
				node.angle = (node.angle ?? 0) + turn;
			}
		}
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const node of placed) {
			minX = Math.min(minX, node.x - node.r);
			minY = Math.min(minY, node.y - node.r);
			maxX = Math.max(maxX, node.x + node.r);
			maxY = Math.max(maxY, node.y + node.r);
		}
		boxes.push({
			placed,
			minX,
			minY,
			width: Math.max(0, maxX - minX),
			height: Math.max(0, maxY - minY),
		});
	});
	if (boxes.length > 1) {
		const gap = detailed ? 28 : 18;
		const bodies = boxes.map((box, index) => {
			const angle = index * 2.399963229728653;
			const spread = 36 * Math.sqrt(index + 1);
			return {
				box,
				x: Math.cos(angle) * spread,
				y: Math.sin(angle) * spread,
				r: Math.hypot(box.width, box.height) / 2 + gap,
			};
		});
		const simulation = d3
			.forceSimulation(bodies)
			.force("collide", d3.forceCollide((body) => body.r).strength(1).iterations(4))
			.force("center", d3.forceCenter(0, 0))
			.stop();
		for (let step = 0; step < 220; step += 1) {
			simulation.tick();
		}
		for (const body of bodies) {
			const dx = body.x - (body.box.minX + body.box.width / 2);
			const dy = body.y - (body.box.minY + body.box.height / 2);
			for (const node of body.box.placed) {
				node.x += dx;
				node.y += dy;
			}
		}
	}

	if (detailed) {
		for (const node of nodeById.values()) {
			if (node.kind !== "cashout" && node.x != null) {
				assignLabelOffsets(node);
			}
		}
	}

	const resolvedLinks = links
		.map((link) => {
			const source = nodeById.get(linkEndpointId(link.source));
			const target = nodeById.get(linkEndpointId(link.target));
			if (!source || !target || source.x == null || target.x == null) {
				return null;
			}
			return { ...link, source, target };
		})
		.filter(Boolean);

	const positioned = [...nodeById.values()].filter((node) => node.x != null && node.y != null);
	const groups = new Map();
	for (const link of resolvedLinks) {
		const key = `${link.source.id}->${link.target.id}`;
		const group = groups.get(key) ?? [];
		group.push(link);
		groups.set(key, group);
	}
	for (const group of groups.values()) {
		group.forEach((link, index) => {
			link.lane = index;
			link.laneCount = group.length;
			link.curve = routedSpoke(link.source, link.target, index, group.length, positioned);
		});
	}
	if (detailed) {
		placeSpokeLabels(resolvedLinks);
	}
	const framed = frameLayout(positioned, resolvedLinks, detailed);
	return { nodes: positioned, links: resolvedLinks, ...framed, natural: true };
}

export { computeLayout };

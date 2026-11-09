// Spoke geometry shared by the layout and by drag updates.
function curveMidpoint(curve) {
	const weight = (a, b, c, d) => a * 0.125 + b * 0.375 + c * 0.375 + d * 0.125;
	return {
		x: weight(curve.start.x, curve.c1.x, curve.c2.x, curve.end.x),
		y: weight(curve.start.y, curve.c1.y, curve.c2.y, curve.end.y),
	};
}

function straightSpoke(source, target, lane, laneCount) {
	return routedSpoke(source, target, lane, laneCount, null);
}

function laneShiftOf(lane, laneCount) {
	return (lane - (laneCount - 1) / 2) * 14;
}

function clearanceNeeded(source, target, nodes, px, py) {
	const dx = target.x - source.x;
	const dy = target.y - source.y;
	const len2 = dx * dx + dy * dy || 1;
	let positive = 0;
	let negative = 0;
	for (const node of nodes) {
		if (node === source || node === target || node.x == null) {
			continue;
		}
		const vx = node.x - source.x;
		const vy = node.y - source.y;
		const along = (vx * dx + vy * dy) / len2;
		if (along <= 0.02 || along >= 0.98) {
			continue;
		}
		const signed = vx * px + vy * py;
		const want = (node.r || 12) + 10;
		if (Math.abs(signed) >= want) {
			continue;
		}
		if (signed >= 0) {
			negative = Math.max(negative, want - signed);
		} else {
			positive = Math.max(positive, want + signed);
		}
	}
	if (positive === 0 && negative === 0) {
		return { sign: 1, bow: 0 };
	}
	if (positive > 0 && negative > 0) {
		return { sign: 1, bow: 0 };
	}
	if (positive > 0) {
		return { sign: 1, bow: positive / 0.72 };
	}
	return { sign: -1, bow: negative / 0.72 };
}

// Straight when the line is clear. Otherwise the curve bows around any icon
// it would have cut through, and parallel payments stay in separate lanes.
function routedSpoke(source, target, lane, laneCount, nodes) {
	const dx = target.x - source.x;
	const dy = target.y - source.y;
	const len = Math.hypot(dx, dy) || 1;
	const ux = dx / len;
	const uy = dy / len;
	const px = -uy;
	const py = ux;
	const laneShift = laneShiftOf(lane, laneCount);
	let bow = 0;
	let sign = 1;

	if (nodes) {
		const clearance = clearanceNeeded(source, target, nodes, px, py);
		sign = clearance.sign;
		bow = clearance.bow;
	}

	if (nodes && !source.hub && !target.hub) {
		let hub = null;
		let nearest = Infinity;
		const midX = (source.x + target.x) / 2;
		const midY = (source.y + target.y) / 2;
		for (const node of nodes) {
			if (!node.hub || node.x == null) {
				continue;
			}
			const distance = Math.hypot(node.x - midX, node.y - midY);
			if (distance < nearest) {
				nearest = distance;
				hub = node;
			}
		}
		if (hub) {
			const a0 = Math.atan2(source.y - hub.y, source.x - hub.x);
			const a1 = Math.atan2(target.y - hub.y, target.x - hub.x);
			let delta = a1 - a0;
			while (delta > Math.PI) {
				delta -= Math.PI * 2;
			}
			while (delta < -Math.PI) {
				delta += Math.PI * 2;
			}
			const blocked = nodes.some((node) => {
				if (node === source || node === target || node === hub || node.x == null || node.hub) {
					return false;
				}
				let rel = Math.atan2(node.y - hub.y, node.x - hub.x) - a0;
				while (rel > Math.PI) {
					rel -= Math.PI * 2;
				}
				while (rel < -Math.PI) {
					rel += Math.PI * 2;
				}
				if (Math.abs(rel) < 0.04 || Math.abs(rel - delta) < 0.04) {
					return false;
				}
				return delta > 0 ? rel > 0 && rel < delta : rel < 0 && rel > delta;
			});
			if (blocked) {
				const mid = a0 + delta / 2;
				const outer = Math.max(
					Math.hypot(source.x - hub.x, source.y - hub.y),
					Math.hypot(target.x - hub.x, target.y - hub.y),
				) + Math.max(source.r || 12, target.r || 12) + 22;
				const signed = (hub.x + Math.cos(mid) * outer - midX) * px + (hub.y + Math.sin(mid) * outer - midY) * py;
				sign = signed >= 0 ? 1 : -1;
				bow = Math.max(bow, Math.abs(signed) / 0.72);
			}
		}
	}

	const shift = sign * bow + laneShift;
	const start = {
		x: source.x + ux * ((source.r || 12) + 4) + px * laneShift,
		y: source.y + uy * ((source.r || 12) + 4) + py * laneShift,
	};
	const end = {
		x: target.x - ux * ((target.r || 12) + 8) + px * laneShift,
		y: target.y - uy * ((target.r || 12) + 8) + py * laneShift,
	};
	const bend = shift - laneShift;
	return {
		start,
		c1: {
			x: start.x + (end.x - start.x) * 0.35 + px * bend,
			y: start.y + (end.y - start.y) * 0.35 + py * bend,
		},
		c2: {
			x: start.x + (end.x - start.x) * 0.65 + px * bend,
			y: start.y + (end.y - start.y) * 0.65 + py * bend,
		},
		end,
	};
}

function curvePoint(curve, t) {
	const u = 1 - t;
	return {
		x: u * u * u * curve.start.x + 3 * u * u * t * curve.c1.x + 3 * u * t * t * curve.c2.x + t * t * t * curve.end.x,
		y: u * u * u * curve.start.y + 3 * u * u * t * curve.c1.y + 3 * u * t * t * curve.c2.y + t * t * t * curve.end.y,
	};
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

	if (route === "cashout" || d.isSelfPayment) {
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
	if (d.curve) {
		const curve = d.curve;
		return `M${curve.start.x},${curve.start.y} C${curve.c1.x},${curve.c1.y} ${curve.c2.x},${curve.c2.y} ${curve.end.x},${curve.end.y}`;
	}
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
	if (d.labelAt) {
		return d.labelAt;
	}
	if (d.curve) {
		return curveMidpoint(d.curve);
	}
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

export { curveMidpoint, curvePoint, routedSpoke, straightSpoke, linkPath, linkLabelPoint };

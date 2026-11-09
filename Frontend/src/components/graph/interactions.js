import * as d3 from "d3";
import { curvePoint, linkLabelPoint, linkPath, routedSpoke } from "./geometry.js";

function sameNode(node, id) {
	return String(node?.id) === String(id);
}

function refreshMovedLinks(links, movedId, nodes) {
	for (const item of links) {
		if (!sameNode(item.source, movedId) && !sameNode(item.target, movedId)) {
			continue;
		}
		if (!item.curve) {
			continue;
		}
		item.curve = routedSpoke(item.source, item.target, item.lane ?? 0, item.laneCount ?? 1, nodes);
		if (item.labelT != null) {
			item.labelAt = curvePoint(item.curve, item.labelT);
		}
	}
}

function redrawLinks(link, linkHit, linkLabel) {
	link.attr("d", linkPath);
	linkHit.attr("d", linkPath);
	if (linkLabel) {
		linkLabel.attr("transform", (item) => {
			const point = linkLabelPoint(item);
			return `translate(${point.x},${point.y})`;
		});
	}
}

export function attachNodeDrag({ node, link, linkHit, linkLabel, links, nodes, onDrag }) {
	const drag = d3
		.drag()
		.clickDistance(4)
		.on("start", function (event) {
			event.sourceEvent?.stopPropagation();
			d3.select(this).raise().style("cursor", "grabbing");
		})
		.on("drag", function (event, d) {
			d.x = event.x;
			d.y = event.y;
			d3.select(this).attr("transform", `translate(${d.x},${d.y})`);
			refreshMovedLinks(links, d.id, nodes);
			redrawLinks(link, linkHit, linkLabel);
			onDrag?.();
		})
		.on("end", function () {
			d3.select(this).style("cursor", "grab");
		});

	node.call(drag).style("cursor", "grab");
}

export function attachHover({ node, link, links, getSelection, applyHighlight }) {
	node
		.on("mouseenter.hover", (_event, d) => {
			const keep = new Set([String(d.id)]);
			for (const item of links) {
				if (sameNode(item.source, d.id) || sameNode(item.target, d.id)) {
					keep.add(String(item.source.id));
					keep.add(String(item.target.id));
				}
			}
			node.style("opacity", (item) => (keep.has(String(item.id)) ? 1 : 0.18));
			link.attr("stroke-opacity", (item) =>
				keep.has(String(item.source.id)) && keep.has(String(item.target.id)) ? 1 : 0.12,
			);
		})
		.on("mouseleave.hover", () => {
			node.style("opacity", null);
			applyHighlight(getSelection());
		});
}

export function downloadBlob(blob, filename) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function toFileSlug(value) {
	return (
		String(value ?? "")
			.trim()
			.replace(/[^a-z0-9]+/gi, "-")
			.replace(/^-+|-+$/g, "")
			.toLowerCase() || "graph"
	);
}

function csvCell(value) {
	if (value === undefined || value === null) {
		return "";
	}
	const text = String(value);
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers, rows) {
	return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

async function toDataUrl(url) {
	const response = await fetch(url);
	const blob = await response.blob();
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}

// An SVG rendered through <img> cannot load external resources, so <image> hrefs are inlined first.
// fitSelector names a pan/zoom group: its transform is dropped and the image is framed around its full content.
export async function exportSvgAsPng(
	svg,
	filename,
	{ background = "#ffffff", scale = 2, fitSelector, padding = 32 } = {},
) {
	const [viewX = 0, viewY = 0, viewWidth, viewHeight] = (svg.getAttribute("viewBox") ?? "")
		.split(/\s+/)
		.map(Number);
	const bounds = svg.getBoundingClientRect();
	let box = { x: viewX, y: viewY, width: viewWidth || bounds.width, height: viewHeight || bounds.height };

	const clone = svg.cloneNode(true);
	const fitTarget = fitSelector ? svg.querySelector(fitSelector) : null;
	if (fitTarget) {
		const content = fitTarget.getBBox();
		if (content.width > 0 && content.height > 0) {
			box = {
				x: content.x - padding,
				y: content.y - padding,
				width: content.width + padding * 2,
				height: content.height + padding * 2,
			};
			clone.querySelector(fitSelector)?.removeAttribute("transform");
		}
	}

	const { width, height } = box;
	clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
	clone.setAttribute("viewBox", `${box.x} ${box.y} ${width} ${height}`);
	clone.setAttribute("width", String(width));
	clone.setAttribute("height", String(height));

	const images = [...clone.querySelectorAll("image")];
	const cache = new Map();
	await Promise.all(
		images.map(async (image) => {
			const href = image.getAttribute("href") ?? image.getAttribute("xlink:href");
			if (!href || href.startsWith("data:")) {
				return;
			}
			if (!cache.has(href)) {
				cache.set(href, toDataUrl(href));
			}
			image.setAttribute("href", await cache.get(href));
		}),
	);

	const markup = new XMLSerializer().serializeToString(clone);
	const svgUrl = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));

	try {
		const img = await new Promise((resolve, reject) => {
			const element = new Image();
			element.onload = () => resolve(element);
			element.onerror = () => reject(new Error("Could not render the graph image."));
			element.src = svgUrl;
		});

		const pixelScale = Math.min(scale, 8000 / Math.max(width, height));
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(width * pixelScale);
		canvas.height = Math.round(height * pixelScale);
		const context = canvas.getContext("2d");
		context.fillStyle = background;
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.drawImage(img, 0, 0, canvas.width, canvas.height);

		const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
		if (!png) {
			throw new Error("Could not create the PNG file.");
		}
		downloadBlob(png, filename);
	} finally {
		URL.revokeObjectURL(svgUrl);
	}
}

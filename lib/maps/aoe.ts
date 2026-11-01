import type { Point } from "./grid";
import { sqKey } from "./grid";

/**
 * Area-of-effect templates on the 5 ft grid. `origin` is a square; `toward`
 * (a square) orients cones, lines and cubes. A square is affected when its
 * centre lies inside the template.
 */
export interface AoeTemplate {
	shape: "sphere" | "cylinder" | "cone" | "line" | "cube";
	origin: Point;
	/** Size in feet: radius (sphere/cylinder), length (cone/line), side (cube). */
	size: number;
	toward?: Point;
	/** Line width in feet (default 5). */
	width?: number;
}

export function aoeSquares(t: AoeTemplate, bounds?: { width: number; height: number }): Set<string> {
	const out = new Set<string>();
	const s = t.size / 5;
	const ox = t.origin.x + 0.5, oy = t.origin.y + 0.5;
	let dx = (t.toward?.x ?? t.origin.x + 1) - t.origin.x, dy = (t.toward?.y ?? t.origin.y) - t.origin.y;
	const len = Math.hypot(dx, dy) || 1;
	dx /= len;
	dy /= len;
	const R = Math.ceil(s) + 2;
	for (let y = t.origin.y - R; y <= t.origin.y + R; y++)
		for (let x = t.origin.x - R; x <= t.origin.x + R; x++) {
			if (bounds && (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height)) continue;
			const px = x + 0.5 - ox, py = y + 0.5 - oy;
			let hit = false;
			switch (t.shape) {
				case "sphere":
				case "cylinder":
					hit = Math.hypot(px, py) <= s + 0.01;
					break;
				case "cone": {
					const along = px * dx + py * dy;
					const across = Math.abs(-px * dy + py * dx);
					hit = along > 0 && along <= s + 0.01 && across <= along * 0.5 + 0.01;
					break;
				}
				case "line": {
					const along = px * dx + py * dy;
					const across = Math.abs(-px * dy + py * dx);
					hit = along > 0 && along <= s + 0.01 && across <= (t.width ?? 5) / 10 + 0.01;
					break;
				}
				case "cube": {
					// cube extends from the origin's face toward `toward` along the dominant axis
					const ax = Math.abs(dx) >= Math.abs(dy);
					const sx = ax ? Math.sign(dx) || 1 : 0, sy = ax ? 0 : Math.sign(dy) || 1;
					const along = ax ? px * sx : py * sy;
					const across = ax ? py : px;
					hit = along > 0 && along <= s + 0.01 && Math.abs(across) <= s / 2 + 0.01;
					break;
				}
			}
			if (hit) out.add(sqKey(x, y));
		}
	return out;
}

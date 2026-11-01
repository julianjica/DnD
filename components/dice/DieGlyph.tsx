import clsx from "clsx";

/** Small flat die silhouette with its value, used by the result card and DiceLog. */
const SHAPES: Record<number, string> = {
	4: "12,2 22,20 2,20",
	6: "3,3 21,3 21,21 3,21",
	8: "12,1 23,12 12,23 1,12",
	10: "12,1 22,10 12,23 2,10",
	12: "12,1.5 22.5,9 18.5,21.5 5.5,21.5 1.5,9",
	20: "12,1 21.5,6.5 21.5,17.5 12,23 2.5,17.5 2.5,6.5",
};

export function DieGlyph({
	sides,
	value,
	dropped,
	nat,
	size = 30,
	className,
}: {
	sides: number;
	value: number;
	dropped?: boolean;
	nat?: "gold" | "red" | null;
	size?: number;
	className?: string;
}) {
	const pts = SHAPES[sides] ?? (sides === 100 ? SHAPES[10] : SHAPES[6]);
	const stroke = nat === "gold" ? "#f5c451" : nat === "red" ? "#f05252" : "rgba(231,215,186,0.7)";
	const fill = nat === "gold" ? "rgba(245,196,81,0.18)" : nat === "red" ? "rgba(240,82,82,0.16)" : "rgba(255,255,255,0.05)";
	const text = String(value);
	return (
		<span
			className={clsx("relative inline-flex shrink-0 items-center justify-center", dropped && "opacity-40", className)}
			style={{ width: size, height: size }}
			title={`d${sides}: ${value}${dropped ? " (dropped)" : ""}`}
		>
			<svg viewBox="0 0 24 24" width={size} height={size} className="absolute inset-0" aria-hidden>
				<polygon points={pts} fill={fill} stroke={stroke} strokeWidth={1.3} strokeLinejoin="round" />
			</svg>
			<span
				className={clsx(
					"relative font-serif font-bold tabular-nums leading-none",
					nat === "gold" ? "text-amber-300" : nat === "red" ? "text-red-400" : "text-stone-100",
					dropped && "line-through decoration-2",
				)}
				style={{ fontSize: size * (text.length > 2 ? 0.3 : text.length > 1 ? 0.36 : 0.42), marginTop: sides === 4 ? size * 0.14 : 0 }}
			>
				{text}
			</span>
		</span>
	);
}

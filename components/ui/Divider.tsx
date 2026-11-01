import { cn } from "./cn";

/** Gold ornamental divider with an optional centered label or diamond. */
export function Divider({ label, className }: { label?: React.ReactNode; className?: string }) {
	return (
		<div className={cn("flex items-center gap-3", className)} role="separator">
			<span className="h-px flex-1 bg-gradient-to-r from-transparent via-gold/50 to-gold/70" />
			{label ? (
				<span className="heading text-xs uppercase tracking-[0.25em] text-gold/90">{label}</span>
			) : (
				<span className="flex items-center gap-1 text-gold/80" aria-hidden>
					<span className="block size-1 rotate-45 bg-gold/60" />
					<span className="block size-2 rotate-45 border border-gold/80" />
					<span className="block size-1 rotate-45 bg-gold/60" />
				</span>
			)}
			<span className="h-px flex-1 bg-gradient-to-l from-transparent via-gold/50 to-gold/70" />
		</div>
	);
}

export default Divider;

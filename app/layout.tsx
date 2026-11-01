import type { Metadata } from "next";
import { Cinzel, EB_Garamond, Inter, IM_Fell_English } from "next/font/google";
import "./globals.css";

const display = Cinzel({ variable: "--font-display", subsets: ["latin"], weight: ["400", "600", "700"] });
const serif = EB_Garamond({ variable: "--font-serif", subsets: ["latin"], style: ["normal", "italic"] });
const sans = Inter({ variable: "--font-sans-ui", subsets: ["latin"] });
const fell = IM_Fell_English({ variable: "--font-fell", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
	title: "DungeonHarness",
	description: "An AI Dungeon Master for solo D&D 5e.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
	return (
		<html lang="en" className={`${display.variable} ${serif.variable} ${sans.variable} ${fell.variable} h-full antialiased`}>
			<body className="min-h-full flex flex-col">{children}</body>
		</html>
	);
}

import Image from "next/image";
import { fetchFileJson } from "./lib/figmaClient";

export default async function Home() {
  await fetchFileJson("MxMXpjiLPbdHlratvH0Wdy");

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      figma-to-html-css-pipline
    </div>
  );
}

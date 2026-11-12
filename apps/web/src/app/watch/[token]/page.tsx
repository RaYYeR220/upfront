import { Suspense } from "react";
import { WatchView } from "@/components/watch-view";

export const metadata = { title: "Watch · Upfront" };

async function ByToken({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <WatchView token={token} />;
}

export default function WatchPage({ params }: PageProps<"/watch/[token]">) {
  return (
    <Suspense fallback={<div className="wrap py-14 text-ink3">Loading…</div>}>
      <ByToken params={params} />
    </Suspense>
  );
}

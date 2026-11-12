import { Suspense } from "react";
import { LiveCheck } from "@/components/live-check";

export const metadata = { title: "Check · Upfront" };

async function CheckById({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LiveCheck id={id} />;
}

export default function CheckPage({ params }: PageProps<"/c/[id]">) {
  return (
    <Suspense fallback={<div className="wrap py-14 text-ink3">Loading the check…</div>}>
      <CheckById params={params} />
    </Suspense>
  );
}

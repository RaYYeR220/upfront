import { ReceiptsFeed } from "@/components/receipts-feed";

export const metadata = { title: "Receipts · Upfront" };

export default function ProofPage() {
  return (
    <div className="wrap py-16 md:py-24">
      <div className="eyebrow">Receipts</div>
      <h1 className="display mt-3 max-w-4xl text-[48px] md:text-[72px]">Every lookup, paid on chain.</h1>
      <p className="mt-5 max-w-2xl text-[17px] text-ink2">
        Each record Upfront buys is a USDC payment on Base, made through Kite Agent Passport inside a spending session that caps
        every lookup and the total. Refusals are listed too. Private checks show the payment, not the company.
      </p>
      <div className="mt-12">
        <ReceiptsFeed />
      </div>
    </div>
  );
}

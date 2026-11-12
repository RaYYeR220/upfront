import { CheckForm } from "@/components/check-form";

export const metadata = { title: "Check a client · Upfront" };

export default function CheckPage() {
  return (
    <div className="wrap py-16 md:py-24">
      <div className="eyebrow">Check a client</div>
      <h1 className="display mt-3 max-w-3xl text-[48px] md:text-[72px]">How should you bill them?</h1>
      <p className="mt-5 max-w-2xl text-[17px] text-ink2">
        Type the company you are about to invoice and the amount. Upfront buys the public records that matter for that
        amount, applies your policy and gives you the terms, every reason backed by a receipt.
      </p>
      <div className="mt-10 max-w-4xl">
        <CheckForm />
      </div>
      <p className="mt-6 text-[13px] text-ink4">
        Three free checks a day. French companies only, for now. Sole traders are never checked.
      </p>
    </div>
  );
}

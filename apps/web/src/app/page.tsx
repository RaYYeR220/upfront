import { CheckForm } from "@/components/check-form";

export default function Home() {
  return (
    <div className="wrap py-24">
      <h1 className="display max-w-4xl text-[56px] md:text-[96px]">Know who to bill upfront.</h1>
      <p className="mt-6 max-w-2xl text-[18px] text-ink2">
        French companies stop paying a median of 144 days before the gazette says so. Upfront buys the public record,
        applies your credit policy and gives you the terms.
      </p>
      <div className="mt-10 max-w-4xl">
        <CheckForm compact />
      </div>
    </div>
  );
}

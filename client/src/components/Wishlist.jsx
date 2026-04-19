import DefaultBackground from "./DefaultBackground";
import { useT } from "@/i18n/index.jsx";

export default function Wishlist() {
  const t = useT();
  return (
    <DefaultBackground>
      <div className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center px-4 pt-8 pb-nav text-center sm:px-6 md:pt-12 md:pb-16">
        <div className="animate-fade-up">
          <span className="hanko-seal mx-auto mb-6 grid h-20 w-20 place-items-center rounded-lg font-display text-2xl font-bold animate-pulse-glow">
            望
          </span>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-hanko">
            {t("wishlist.labelJp")}
          </p>
          <h1 className="mt-3 font-display text-4xl font-light italic text-washi md:text-6xl">
            {t("wishlist.comingSoon")}{" "}
            <span className="text-hanko-gradient font-semibold not-italic">
              {t("wishlist.comingSoonAccent")}
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-md text-sm text-washi-muted md:text-base">
            {t("wishlist.body")}
          </p>

          <a
            href="/dashboard"
            className="mt-8 inline-flex items-center gap-2 rounded-full border border-border bg-ink-1/60 px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-washi-muted backdrop-blur transition hover:border-hanko/40 hover:text-washi"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            {t("wishlist.backLib")}
          </a>
        </div>
      </div>
    </DefaultBackground>
  );
}

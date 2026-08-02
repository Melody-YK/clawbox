import ClawIcon from "./ClawIcon";
import { t } from "@/lib/i18n";

interface WelcomeStepProps {
  onNext: () => void;
}

export default function WelcomeStep({ onNext }: WelcomeStepProps) {
  return (
    <div className="w-full max-w-[520px]">
      <div className="card-surface rounded-2xl p-8">
        <div className="flex flex-col items-center gap-3 mb-6">
          <ClawIcon size={64} />
          <h1 className="text-2xl font-bold font-display text-center">
            {t("welcome")}
          </h1>
        </div>
        <p className="text-[var(--text-secondary)] mb-6 leading-relaxed text-center">
          {t("welcome_description")}
        </p>
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onNext}
            className="px-8 py-3 btn-gradient text-white rounded-lg font-semibold text-sm transition transform hover:scale-105 cursor-pointer"
          >
            {t("get_started")}
          </button>
        </div>
      </div>
    </div>
  );
}
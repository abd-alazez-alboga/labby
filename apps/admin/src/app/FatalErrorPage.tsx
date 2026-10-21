/**
 * Shown when the runtime config (public/config.json) cannot be loaded at
 * boot. Rendered before i18n is guaranteed to exist, so the copy is static
 * and intentionally bilingual.
 */
export function FatalErrorPage({ detail }: { detail?: string }) {
  return (
    <div className="fatal-error" role="alert">
      <div className="fatal-error__card">
        <img className="brand__mark brand__mark--lg" src="/images/labby-icon.png" alt="" />
        <h1 className="fatal-error__title">Labby Admin failed to start</h1>
        <p>Could not load the application configuration. Please try again later.</p>
        <p className="fatal-error__ar" dir="rtl" lang="ar">
          تعذّر تحميل إعدادات التطبيق. يرجى المحاولة مرة أخرى لاحقًا.
        </p>
        {detail ? <p className="fatal-error__detail">{detail}</p> : null}
      </div>
    </div>
  );
}

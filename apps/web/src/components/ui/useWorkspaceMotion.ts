import { useEffect, useRef } from "react";

const surfaces = [
  ".ui-page-layout > *",
  ".records-main > *",
  ".agents-workspace > *",
  ".admin-workspace > *",
  ".agent-detail > *",
  ".action-dashboard > *",
  ".crm-workspace > *",
  ".deals-workspace > *",
  ".orders-workspace > *",
  ".integrations-workspace > *",
  ".command-center-workspace > *",
  ".operations-dashboard > *",
  ".reports-workspace > *",
  ".workspace-main > *",
  ".lead-detail > *",
  ".tab-panel",
  '[role="tabpanel"]'
].join(",");

// Observe mounted surfaces only; changes to existing records must not replay the entrance.
export function useWorkspaceMotion(navigationKey: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof root.animate !== "function") return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const styles = getComputedStyle(root);
    const duration = parseFloat(styles.getPropertyValue("--motion-reveal")) || 700;
    const stagger = parseFloat(styles.getPropertyValue("--motion-stagger")) || 120;
    const staggerLimit = parseFloat(styles.getPropertyValue("--motion-stagger-limit")) || 480;
    const distance = styles.getPropertyValue("--motion-distance").trim() || "18px";
    const easing = styles.getPropertyValue("--motion-ease").trim() || "cubic-bezier(0.22, 0.61, 0.36, 1)";
    const seen = new WeakSet<Element>();
    const running = new Set<Animation>();
    let frame = 0;

    const reveal = (): void => {
      frame = 0;
      if (preference.matches) return;
      const candidates = Array.from(root.querySelectorAll<HTMLElement>(surfaces));
      const fresh = candidates.filter((element) => !seen.has(element));
      for (const element of fresh) seen.add(element);
      const topLevel = fresh.filter(
        (element) => !fresh.some((parent) => parent !== element && parent.contains(element))
      );
      let index = 0;
      for (const element of topLevel) {
        if (
          element.matches("nav, .state-block, .refresh-error, [role='alert']") ||
          !element.getClientRects().length
        )
          continue;
        const animation = element.animate(
          [
            { opacity: 0, translate: `0 ${distance}` },
            { opacity: 1, translate: "0 0" }
          ],
          {
            duration,
            delay: Math.min(index++ * stagger, staggerLimit),
            easing,
            fill: "backwards"
          }
        );
        running.add(animation);
        void animation.finished.then(
          () => running.delete(animation),
          () => running.delete(animation)
        );
      }
    };
    const observer = new MutationObserver((records) => {
      if (
        records.some((record) =>
          Array.from(record.addedNodes).some((node) => node instanceof HTMLElement)
        ) &&
        !frame
      ) {
        frame = requestAnimationFrame(reveal);
      }
    });
    const stop = (): void => {
      if (preference.matches) for (const animation of running) animation.cancel();
    };
    reveal();
    observer.observe(root, { childList: true, subtree: true });
    preference.addEventListener("change", stop);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      preference.removeEventListener("change", stop);
      for (const animation of running) animation.cancel();
    };
  }, [navigationKey]);
  return ref;
}

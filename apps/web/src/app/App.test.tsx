import { renderToString } from "react-dom/server";
import { App } from "./App.js";

describe("web app", () => {
  it("boots the M0 scaffold", () => {
    const html = renderToString(<App />);

    expect(html).toContain("Shilabs AI Sales Engine");
    expect(html).toContain("M0 scaffold");
  });
});

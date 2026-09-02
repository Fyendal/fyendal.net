import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import type { StoreState } from "../store/types.js";
import { validateAuthInput } from "./validation.js";

const authStore = vi.hoisted(() => ({
  state: {
    login: vi.fn(),
    register: vi.fn(),
  } as unknown as StoreState,
}));

vi.mock("../store.js", () => ({
  useStore: (selector: (state: StoreState) => unknown) => selector(authStore.state),
}));

import { Auth } from "./AuthCard.js";

describe("registration username validation", () => {
  it("accepts only 3–20 letters, numbers, or underscores", () => {
    expect(validateAuthInput("Player_1", "password1", "register")).toBeNull();
    expect(validateAuthInput("ab", "password1", "register")).toBe("invalidUsername");
    expect(validateAuthInput("a".repeat(21), "password1", "register")).toBe("invalidUsername");
    expect(validateAuthInput("has space", "password1", "register")).toBe("invalidUsername");
    expect(validateAuthInput("dash-name", "password1", "register")).toBe("invalidUsername");
    expect(validateAuthInput("pläyer", "password1", "register")).toBe("invalidUsername");
  });
});

describe("authentication form", () => {
  it("uses persistent labels and sentence-case placeholders", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <Auth />
      </TestI18nProvider>,
    );

    expect(html).toContain("<span>Username</span>");
    expect(html).toContain('placeholder="Dracai"');
    expect(html).toContain("<span>Password</span>");
    expect(html).toContain('placeholder="Your password"');
  });

  it("requires concise terms agreement during registration", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <Auth initialMode="register" />
      </TestI18nProvider>,
    );

    expect(html).toContain('type="checkbox"');
    expect(html).toContain('name="termsAccepted"');
    expect(html).toContain("required");
    expect(html).toContain('href="/terms/"');
    expect(html).toContain('href="/privacy/"');
    expect(html).toContain("I agree to the");
  });

  it("renders account controls in Chinese", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider locale="zh-Hans">
        <Auth initialMode="register" />
      </TestI18nProvider>,
    );

    expect(html).toContain(">登录</button>");
    expect(html).toContain(">注册</button>");
    expect(html).toContain("<span>用户名</span>");
    expect(html).toContain('placeholder="至少 8 个字符"');
    expect(html).toContain("服务条款");
  });
});

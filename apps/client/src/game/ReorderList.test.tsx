import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { moveOrderItem, ReorderList, ReorderMoveControls } from "./ReorderList.js";

describe("moveOrderItem", () => {
  it("moves one item and ignores out-of-range moves", () => {
    expect(moveOrderItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveOrderItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveOrderItem(["a", "b"], -1, 0)).toEqual(["a", "b"]);
    expect(moveOrderItem(["a", "b"], 0, 2)).toEqual(["a", "b"]);
  });
});

describe("ReorderList", () => {
  it("renders draggable rows with a grip and the caller's content", () => {
    const html = renderToStaticMarkup(
      <ReorderList
        items={["first", "second"]}
        itemKey={(item) => item}
        dragType="application/x-test"
        className="list"
        itemClassName="row"
        label="Order"
        describedBy="help"
        onMove={vi.fn()}
        renderItem={(item, index) => <span className="content">{`${index}:${item}`}</span>}
      />,
    );
    expect(html).toContain('<ol class="list" aria-label="Order" aria-describedby="help">');
    expect(html.match(/<li class="row" draggable="true">/g)).toHaveLength(2);
    expect(html.match(/\/icons\/ui\/grip\.svg/g)).toHaveLength(2);
    expect(html).toContain('<span class="content">0:first</span>');
    expect(html).toContain('<span class="content">1:second</span>');
  });

  it("renders one labelled button per move, disabling the impossible ones", () => {
    const html = renderToStaticMarkup(
      <ReorderMoveControls
        index={0}
        onMove={vi.fn()}
        moves={[
          { to: -1, icon: "chevron-up", tooltip: "Up", label: "Move A up", disabled: true },
          { to: 1, icon: "chevron-down", tooltip: "Down", label: "Move A down", disabled: false },
        ]}
      />,
    );
    expect(html).toContain('class="trigger-order-controls trigger-order-move"');
    expect(html).toMatch(/aria-label="Move A up" disabled=""/);
    expect(html).not.toMatch(/aria-label="Move A down" disabled=""/);
    expect(html).toContain("/icons/ui/chevron-down.svg");
  });
});

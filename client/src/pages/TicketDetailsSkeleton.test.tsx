import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TicketDetailsSkeleton } from "./TicketDetailsSkeleton.tsx";

describe("TicketDetailsSkeleton", () => {
  it("renders two skeleton placeholders", () => {
    const { container } = render(<TicketDetailsSkeleton />);

    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
  });
});

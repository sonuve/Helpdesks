import type { ReactElement } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

// Also wraps in a MemoryRouter — anything using react-router-dom's `Link`
// (e.g. TicketsTable.tsx's subject links) throws without a Router
// ancestor. Pass `initialEntries` for a component that reads route state
// itself (e.g. TicketDetailPage.tsx's `useParams`); wrap `ui` in its own
// `<Routes>`/`<Route>` in that case so the param actually resolves — see
// TicketDetailPage.test.tsx.
export function renderWithQuery(
  ui: ReactElement,
  options?: RenderOptions & { initialEntries?: string[] },
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { initialEntries, ...renderOptions } = options ?? {};

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
    </QueryClientProvider>,
    renderOptions,
  );
}

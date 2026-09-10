import { fireEvent, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/test/render-with-query.tsx";
import { UserForm } from "./UserForm.tsx";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

beforeEach(() => {
  mockedAxios.post.mockReset();
  mockedAxios.isAxiosError.mockReset();
});

function renderForm() {
  const onSuccess = vi.fn();
  const { container } = renderWithQuery(<UserForm onSuccess={onSuccess} />);
  return {
    onSuccess,
    name: screen.getByLabelText("Name"),
    email: screen.getByLabelText("Email"),
    password: screen.getByLabelText("Password"),
    submit: () => {
      // Submit the form directly rather than clicking the submit button: a
      // click runs the browser's native HTML5 constraint validation first
      // (e.g. the type="email" input), which would block the invalid-email
      // case below before React's onSubmit / zod validation ever runs.
      fireEvent.submit(container.querySelector("form")!);
    },
  };
}

describe("UserForm", () => {
  it("renders name, email, and password fields", () => {
    renderForm();

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("shows validation errors for a name under 3 chars and a password under 5 chars", async () => {
    const { name, email, password, submit } = renderForm();

    fireEvent.change(name, { target: { value: "ab" } });
    fireEvent.change(email, { target: { value: "not-an-email" } });
    fireEvent.change(password, { target: { value: "1234" } });
    submit();

    expect(await screen.findByText("Name must be at least 3 characters")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByText("Password must be at least 5 characters")).toBeInTheDocument();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("creates the user and calls onSuccess on valid submission", async () => {
    mockedAxios.post.mockResolvedValue({ data: { user: { id: "1" } } });

    const { name, email, password, submit, onSuccess } = renderForm();

    fireEvent.change(name, { target: { value: "Jane Doe" } });
    fireEvent.change(email, { target: { value: "jane@example.com" } });
    fireEvent.change(password, { target: { value: "secret" } });
    submit();

    await waitFor(() =>
      expect(mockedAxios.post).toHaveBeenCalledWith("/api/users", {
        name: "Jane Doe",
        email: "jane@example.com",
        password: "secret",
      }),
    );

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("shows a server error and does not call onSuccess when creation fails", async () => {
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.post.mockRejectedValue({
      response: { data: { error: "A user with that email already exists" } },
    });

    const { name, email, password, submit, onSuccess } = renderForm();

    fireEvent.change(name, { target: { value: "Jane Doe" } });
    fireEvent.change(email, { target: { value: "jane@example.com" } });
    fireEvent.change(password, { target: { value: "secret" } });
    submit();

    expect(
      await screen.findByText("A user with that email already exists"),
    ).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

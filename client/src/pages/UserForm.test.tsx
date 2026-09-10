import { fireEvent, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import { Role } from "core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/test/render-with-query.tsx";
import { UserForm } from "./UserForm.tsx";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

beforeEach(() => {
  mockedAxios.post.mockReset();
  mockedAxios.patch.mockReset();
  mockedAxios.isAxiosError.mockReset();
});

// Radix's Select isn't a native input, so react-hook-form wires it up via
// Controller rather than register() — selecting a value means driving the
// real combobox/option interaction, not fireEvent.change.
async function selectRole(role: "Admin" | "Agent") {
  fireEvent.click(screen.getByLabelText("Role"));
  fireEvent.click(await screen.findByRole("option", { name: role }));
}

function renderCreateForm() {
  const onSuccess = vi.fn();
  const { container } = renderWithQuery(<UserForm mode="create" onSuccess={onSuccess} />);
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

function renderEditForm() {
  const onSuccess = vi.fn();
  const { container } = renderWithQuery(
    <UserForm
      mode="edit"
      userId="42"
      defaultValues={{ name: "Jane Doe", email: "jane@example.com", role: Role.AGENT }}
      onSuccess={onSuccess}
    />,
  );
  return {
    onSuccess,
    name: screen.getByLabelText("Name"),
    email: screen.getByLabelText("Email"),
    password: screen.getByLabelText("Password"),
    submit: () => {
      fireEvent.submit(container.querySelector("form")!);
    },
  };
}

describe("UserForm", () => {
  describe("create mode", () => {
    it("renders name, email, role, and password fields", () => {
      renderCreateForm();

      expect(screen.getByLabelText("Name")).toBeInTheDocument();
      expect(screen.getByLabelText("Email")).toBeInTheDocument();
      expect(screen.getByLabelText("Role")).toBeInTheDocument();
      expect(screen.getByLabelText("Password")).toBeInTheDocument();
    });

    it("shows validation errors for a name under 3 chars, a missing role, and a password under 5 chars", async () => {
      const { name, email, password, submit } = renderCreateForm();

      fireEvent.change(name, { target: { value: "ab" } });
      fireEvent.change(email, { target: { value: "not-an-email" } });
      fireEvent.change(password, { target: { value: "1234" } });
      submit();

      expect(await screen.findByText("Name must be at least 3 characters")).toBeInTheDocument();
      expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
      expect(screen.getByText("Role is required")).toBeInTheDocument();
      expect(screen.getByText("Password must be at least 5 characters")).toBeInTheDocument();
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it("creates the user and calls onSuccess on valid submission", async () => {
      mockedAxios.post.mockResolvedValue({ data: { user: { id: "1" } } });

      const { name, email, password, submit, onSuccess } = renderCreateForm();

      fireEvent.change(name, { target: { value: "Jane Doe" } });
      fireEvent.change(email, { target: { value: "jane@example.com" } });
      await selectRole("Agent");
      fireEvent.change(password, { target: { value: "secret" } });
      submit();

      await waitFor(() =>
        expect(mockedAxios.post).toHaveBeenCalledWith("/api/users", {
          name: "Jane Doe",
          email: "jane@example.com",
          role: Role.AGENT,
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

      const { name, email, password, submit, onSuccess } = renderCreateForm();

      fireEvent.change(name, { target: { value: "Jane Doe" } });
      fireEvent.change(email, { target: { value: "jane@example.com" } });
      await selectRole("Agent");
      fireEvent.change(password, { target: { value: "secret" } });
      submit();

      expect(
        await screen.findByText("A user with that email already exists"),
      ).toBeInTheDocument();
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it("shows a generic error when the failure carries no structured API message", async () => {
      // isAxiosError isn't stubbed here, so it returns undefined (as a real
      // network error / non-Axios rejection would fail the isAxiosError check).
      mockedAxios.post.mockRejectedValue(new Error("Network Error"));

      const { name, email, password, submit, onSuccess } = renderCreateForm();

      fireEvent.change(name, { target: { value: "Jane Doe" } });
      fireEvent.change(email, { target: { value: "jane@example.com" } });
      await selectRole("Agent");
      fireEvent.change(password, { target: { value: "secret" } });
      submit();

      expect(
        await screen.findByText("Could not create user. Please try again."),
      ).toBeInTheDocument();
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it("shows 'Email is required' rather than a format error when the email is left blank", async () => {
      const { name, password, submit } = renderCreateForm();

      fireEvent.change(name, { target: { value: "Jane Doe" } });
      fireEvent.change(password, { target: { value: "secret" } });
      submit();

      expect(await screen.findByText("Email is required")).toBeInTheDocument();
      expect(screen.queryByText("Enter a valid email address")).not.toBeInTheDocument();
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it("accepts a name and password at the minimum allowed length", async () => {
      mockedAxios.post.mockResolvedValue({ data: { user: { id: "1" } } });

      const { name, email, password, submit, onSuccess } = renderCreateForm();

      // "abc" is 3 chars (the minimum for name); "12345" is 5 chars (the
      // minimum for password) — both should be accepted, not rejected as
      // one character short.
      fireEvent.change(name, { target: { value: "abc" } });
      fireEvent.change(email, { target: { value: "jane@example.com" } });
      await selectRole("Agent");
      fireEvent.change(password, { target: { value: "12345" } });
      submit();

      await waitFor(() => expect(onSuccess).toHaveBeenCalled());
      expect(screen.queryByText("Name must be at least 3 characters")).not.toBeInTheDocument();
      expect(screen.queryByText("Password must be at least 5 characters")).not.toBeInTheDocument();
    });

    it("disables the submit button and shows a submitting label while the request is in flight", async () => {
      mockedAxios.post.mockReturnValue(new Promise(() => {}));

      const { name, email, password, submit } = renderCreateForm();

      fireEvent.change(name, { target: { value: "Jane Doe" } });
      fireEvent.change(email, { target: { value: "jane@example.com" } });
      await selectRole("Agent");
      fireEvent.change(password, { target: { value: "secret" } });
      submit();

      const submitButton = await screen.findByRole("button", { name: "Creating..." });
      expect(submitButton).toBeDisabled();
    });
  });

  describe("edit mode", () => {
    it("pre-fills the name, email, and role, and leaves the password blank", () => {
      const { name, email, password } = renderEditForm();

      expect(name).toHaveValue("Jane Doe");
      expect(email).toHaveValue("jane@example.com");
      expect(screen.getByLabelText("Role")).toHaveTextContent("Agent");
      expect(password).toHaveValue("");
    });

    it("shows a hint that a blank password leaves the current one unchanged", () => {
      renderEditForm();

      expect(screen.getByText("Leave blank to keep the current password.")).toBeInTheDocument();
    });

    it("submits with an empty password and does not fail validation", async () => {
      mockedAxios.patch.mockResolvedValue({ data: { user: { id: "42" } } });

      const { submit, onSuccess } = renderEditForm();

      submit();

      await waitFor(() =>
        expect(mockedAxios.patch).toHaveBeenCalledWith("/api/users/42", {
          name: "Jane Doe",
          email: "jane@example.com",
          role: Role.AGENT,
          password: "",
        }),
      );
      await waitFor(() => expect(onSuccess).toHaveBeenCalled());
      expect(screen.queryByText("Password must be at least 5 characters")).not.toBeInTheDocument();
    });

    it("rejects a non-empty password under 5 characters", async () => {
      const { password, submit } = renderEditForm();

      fireEvent.change(password, { target: { value: "1234" } });
      submit();

      expect(await screen.findByText("Password must be at least 5 characters")).toBeInTheDocument();
      expect(mockedAxios.patch).not.toHaveBeenCalled();
    });

    it("sends a new password when one is provided", async () => {
      mockedAxios.patch.mockResolvedValue({ data: { user: { id: "42" } } });

      const { password, submit, onSuccess } = renderEditForm();

      fireEvent.change(password, { target: { value: "newsecret" } });
      submit();

      await waitFor(() =>
        expect(mockedAxios.patch).toHaveBeenCalledWith("/api/users/42", {
          name: "Jane Doe",
          email: "jane@example.com",
          role: Role.AGENT,
          password: "newsecret",
        }),
      );
      await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    });

    it("shows an edit-specific error and does not call onSuccess when saving fails", async () => {
      mockedAxios.isAxiosError.mockReturnValue(true);
      mockedAxios.patch.mockRejectedValue({
        response: { data: { error: "A user with that email already exists" } },
      });

      const { submit, onSuccess } = renderEditForm();

      submit();

      expect(
        await screen.findByText("A user with that email already exists"),
      ).toBeInTheDocument();
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it("shows a generic edit error when the failure carries no structured API message", async () => {
      mockedAxios.patch.mockRejectedValue(new Error("Network Error"));

      const { submit, onSuccess } = renderEditForm();

      submit();

      expect(
        await screen.findByText("Could not update user. Please try again."),
      ).toBeInTheDocument();
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it("disables the submit button and shows a saving label while the request is in flight", async () => {
      mockedAxios.patch.mockReturnValue(new Promise(() => {}));

      const { submit } = renderEditForm();

      submit();

      const submitButton = await screen.findByRole("button", { name: "Saving..." });
      expect(submitButton).toBeDisabled();
    });
  });
});

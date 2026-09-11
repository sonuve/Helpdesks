import axios from "axios";

// Every mutation's onError across the client pulls a message out of a
// failed request the same way: the server returns `{ error: string }` for
// a validation/business-rule failure (see CLAUDE.md's "Error handling"),
// so an AxiosError's response body is checked first, falling back to a
// caller-supplied message for anything else (network failure, unexpected
// response shape).
export function getErrorMessage(error: unknown, fallback: string): string {
  return (axios.isAxiosError(error) && error.response?.data?.error) || fallback;
}

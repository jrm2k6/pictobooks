export const WAITLIST_ENDPOINT = "/api/waitlist";

export type WaitlistSignupRequest = {
  email: string;
  turnstileToken: string;
  source?: string;
  campaign?: string;
  page?: string;
};

export type WaitlistSignupSuccessResponse = {
  ok: true;
  status: "created" | "updated";
};

export type WaitlistSignupErrorResponse = {
  ok: false;
  code: string;
  message: string;
};

export type WaitlistSignupResponse =
  | WaitlistSignupSuccessResponse
  | WaitlistSignupErrorResponse;

import { expect, test } from "vitest";
import { amzDate, authorization } from "./backup-sigv4.js";

// The published AWS Signature Version 4 test suite's "get-vanilla" request.
const CREDENTIALS = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};
const EMPTY_PAYLOAD =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

test("the signature of the published get-vanilla request is the one AWS publishes", () => {
  const headers = {
    host: "example.amazonaws.com",
    "x-amz-date": "20150830T123600Z",
  };
  expect(
    authorization(
      { method: "GET", path: "/", headers, payloadHash: EMPTY_PAYLOAD },
      CREDENTIALS,
      { region: "us-east-1", service: "service" },
      "20150830T123600Z",
    ),
  ).toBe(
    "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
  );
});

test("the request time is written as the basic ISO 8601 form SigV4 signs", () => {
  expect(amzDate(new Date("2015-08-30T12:36:00.123Z"))).toBe(
    "20150830T123600Z",
  );
});

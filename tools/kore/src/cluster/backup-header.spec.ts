import { expect, test } from "vitest";
import { parseDumpHeader } from "./backup-header.js";

const HEADER = [
  "--",
  "-- PostgreSQL database dump",
  "--",
  "",
  "-- Dumped from database version 17.5 (Debian 17.5-1.pgdg120+1)",
  "-- Dumped by pg_dump version 18.1 (Debian 18.1-1.pgdg120+1)",
  "",
  "CREATE TABLE t (id int);",
  "",
].join("\n");

test("the PostgreSQL major is the source server's, and the dump tool version is the one pg_dump reports", () => {
  expect(parseDumpHeader(HEADER)).toEqual({
    postgresMajor: 17,
    dumpVersion: "18.1",
  });
});

test("a dump with no source version line is refused, because its PostgreSQL major is unknown", () => {
  expect(() =>
    parseDumpHeader("-- Dumped by pg_dump version 18.1\nCREATE TABLE t();\n"),
  ).toThrow(
    "the pg_dump output has no 'Dumped from database version' line, so its PostgreSQL major is unknown; the backup is not written",
  );
});

test("a dump with no tool version line is refused rather than recorded without one", () => {
  expect(() =>
    parseDumpHeader(
      "-- Dumped from database version 17.5\nCREATE TABLE t();\n",
    ),
  ).toThrow(
    "the pg_dump output has no 'Dumped by pg_dump version' line; the backup is not written",
  );
});

/**
 * Regression tests for parsePath's spec-legal compact arc lexer.
 *
 * Per the SVG grammar the two arc flags are single digits and may be
 * concatenated with each other and the following coordinate
 * ("a25 25 0 017 7"), so they must be lexed digit-wise. The first cut of that
 * lexer accepted ANY character as a flag digit, so a pathological glued token
 * like "0.57" made '.' become the sweep flag (truthy != "0" -> sweep=true)
 * and silently fabricated an arc. A non-digit character where a flag digit is
 * expected now marks the command malformed so it is dropped instead.
 */

import { describe, expect, it } from "vitest";
import { parsePath } from "../pathDataIO";

describe("parsePath arc flag lexing", () => {
  it("parses spec-legal compact flags glued to the endpoint", () => {
    const result = parsePath("M0 0a25 25 0 017 7");
    const cmd = result.subPaths[0].commands[1];
    expect(cmd.type).toBe("A");
    expect(cmd.arcParams).toEqual({ rx: 25, ry: 25, xRotation: 0, largeArc: false, sweep: true });
    expect(cmd.points[0]).toEqual({ x: 7, y: 7 });
  });

  it("keeps multi-digit radii when flags are compact", () => {
    const result = parsePath("M0 0A5.5 6.5 10 1110 20");
    const cmd = result.subPaths[0].commands[1];
    expect(cmd.arcParams).toEqual({
      rx: 5.5,
      ry: 6.5,
      xRotation: 10,
      largeArc: true,
      sweep: true,
    });
    expect(cmd.points[0]).toEqual({ x: 10, y: 20 });
  });

  it("reads a glued decimal endpoint after complete flags instead of eating it into the flags", () => {
    // "011.5" = largeArc 0, sweep 1, remainder "1.5" consumed as the coordinate.
    const result = parsePath("M0 0A2 2 0 011.5 3");
    const cmd = result.subPaths[0].commands[1];
    expect(cmd.type).toBe("A");
    expect(cmd.arcParams).toEqual({ rx: 2, ry: 2, xRotation: 0, largeArc: false, sweep: true });
    expect(cmd.points[0]).toEqual({ x: 1.5, y: 3 });
  });

  it("drops the arc when a decimal fragment sits at the second flag position", () => {
    // Pathological glued decimal: token "0.57" makes '.' the sweep flag under
    // the old lexer (truthy != "0" -> sweep=true), then "57" became endX —
    // fabricating an arc that was never authored. The string is not spec-legal
    // (no sweep flag digit), so the whole command must be dropped.
    const result = parsePath("M0 0A5 5 0 0.57 7");
    expect(result.subPaths[0].commands.map((c) => c.type)).toEqual(["M"]);
  });

  it("drops the arc when a flag argument is missing entirely", () => {
    // Radii + rotation present but no flags/endpoint: both flag reads fail.
    const result = parsePath("M0 0A5 5 0");
    expect(result.subPaths[0].commands.map((c) => c.type)).toEqual(["M"]);
  });

  it("does not let a rejected glued token leak into a following arc command", () => {
    // The malformed arc's partially-consumed token must be discarded so the
    // trailing valid arc parses with its own arguments.
    const result = parsePath("M0 0A5 5 0 0.57 7 A5 5 0 0 1 10 20");
    const cmds = result.subPaths[0].commands;
    expect(cmds.map((c) => c.type)).toEqual(["M", "A"]);
    expect(cmds[1].arcParams!.largeArc).toBe(false);
    expect(cmds[1].arcParams!.sweep).toBe(true);
    expect(cmds[1].points[0]).toEqual({ x: 10, y: 20 });
  });
});

import { describe, expect, it, vi } from "vitest";
import { executeBotmaxGatewayCommand } from "./command-exec.js";

const listDevicePairingMock = vi.fn();
const approveDevicePairingMock = vi.fn();
const runPluginCommandWithTimeoutMock = vi.fn();

vi.mock("openclaw/plugin-sdk", () => ({
  listDevicePairing: (...args: unknown[]) => listDevicePairingMock(...args),
  approveDevicePairing: (...args: unknown[]) => approveDevicePairingMock(...args),
  runPluginCommandWithTimeout: (...args: unknown[]) => runPluginCommandWithTimeoutMock(...args),
}));

describe("botmax command execution", () => {
  it("maps devices list to gateway method", async () => {
    listDevicePairingMock.mockReset();
    approveDevicePairingMock.mockReset();
    runPluginCommandWithTimeoutMock.mockReset();
    listDevicePairingMock.mockResolvedValueOnce({ pending: [] });

    const result = await executeBotmaxGatewayCommand({
      command: "openclaw devices list",
    });

    expect(listDevicePairingMock).toHaveBeenCalledTimes(1);
    expect(approveDevicePairingMock).not.toHaveBeenCalled();
    expect(runPluginCommandWithTimeoutMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.method).toBe("device.pair.list");
  });

  it("maps devices approve latest", async () => {
    listDevicePairingMock.mockReset();
    approveDevicePairingMock.mockReset();
    runPluginCommandWithTimeoutMock.mockReset();
    listDevicePairingMock.mockResolvedValueOnce({
      pending: [{ requestId: "req-001" }],
      paired: [],
    });
    approveDevicePairingMock.mockResolvedValueOnce({ requestId: "req-001", device: { id: "d1" } });

    const result = await executeBotmaxGatewayCommand({
      command: "openclaw devices approve --latest",
      timeoutMs: 5000,
    });

    expect(listDevicePairingMock).toHaveBeenCalledTimes(1);
    expect(approveDevicePairingMock).toHaveBeenCalledWith("req-001");
    expect(runPluginCommandWithTimeoutMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.method).toBe("device.pair.approve");
  });

  it("returns validation error for unsupported command", async () => {
    listDevicePairingMock.mockReset();
    approveDevicePairingMock.mockReset();
    runPluginCommandWithTimeoutMock.mockReset();

    const result = await executeBotmaxGatewayCommand({
      command: "openclaw foo bar",
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain("unsupported openclaw namespace");
  });

  it("maps gateway call with params", async () => {
    listDevicePairingMock.mockReset();
    approveDevicePairingMock.mockReset();
    runPluginCommandWithTimeoutMock.mockReset();
    runPluginCommandWithTimeoutMock.mockResolvedValueOnce({
      code: 0,
      stdout: '{"ok":true}',
      stderr: "",
    });

    const result = await executeBotmaxGatewayCommand({
      command: 'openclaw gateway call health --params "{\\"foo\\":1}"',
    });

    expect(runPluginCommandWithTimeoutMock).toHaveBeenCalledWith({
      argv: ["openclaw", "gateway", "call", "health", "--params", '{"foo":1}', "--json"],
      timeoutMs: 30000,
    });
    expect(result.ok).toBe(true);
    expect(result.method).toBe("health");
  });
});

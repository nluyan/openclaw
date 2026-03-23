import { describe, expect, it, vi } from "vitest";
import { executeBotmaxGatewayCommand } from "./command-exec.js";

const listDevicePairingMock = vi.fn();
const approveDevicePairingMock = vi.fn();
const rejectDevicePairingMock = vi.fn();
const runPluginCommandWithTimeoutMock = vi.fn();
const removePairedDeviceLocallyMock = vi.fn();
const clearDevicePairingLocallyMock = vi.fn();
const rotateDeviceTokenLocallyMock = vi.fn();
const revokeDeviceTokenLocallyMock = vi.fn();
const listNodePairingLocallyMock = vi.fn();
const approveNodePairingLocallyMock = vi.fn();
const rejectNodePairingLocallyMock = vi.fn();
const renamePairedNodeLocallyMock = vi.fn();

vi.mock("./runtime-api.js", () => ({
  listDevicePairing: (...args: unknown[]) => listDevicePairingMock(...args),
  approveDevicePairing: (...args: unknown[]) => approveDevicePairingMock(...args),
  rejectDevicePairing: (...args: unknown[]) => rejectDevicePairingMock(...args),
  runPluginCommandWithTimeout: (...args: unknown[]) => runPluginCommandWithTimeoutMock(...args),
}));

vi.mock("./local-state-commands.js", () => ({
  removePairedDeviceLocally: (...args: unknown[]) => removePairedDeviceLocallyMock(...args),
  clearDevicePairingLocally: (...args: unknown[]) => clearDevicePairingLocallyMock(...args),
  rotateDeviceTokenLocally: (...args: unknown[]) => rotateDeviceTokenLocallyMock(...args),
  revokeDeviceTokenLocally: (...args: unknown[]) => revokeDeviceTokenLocallyMock(...args),
  listNodePairingLocally: (...args: unknown[]) => listNodePairingLocallyMock(...args),
  approveNodePairingLocally: (...args: unknown[]) => approveNodePairingLocallyMock(...args),
  rejectNodePairingLocally: (...args: unknown[]) => rejectNodePairingLocallyMock(...args),
  renamePairedNodeLocally: (...args: unknown[]) => renamePairedNodeLocallyMock(...args),
}));

function resetAllMocks() {
  listDevicePairingMock.mockReset();
  approveDevicePairingMock.mockReset();
  rejectDevicePairingMock.mockReset();
  runPluginCommandWithTimeoutMock.mockReset();
  removePairedDeviceLocallyMock.mockReset();
  clearDevicePairingLocallyMock.mockReset();
  rotateDeviceTokenLocallyMock.mockReset();
  revokeDeviceTokenLocallyMock.mockReset();
  listNodePairingLocallyMock.mockReset();
  approveNodePairingLocallyMock.mockReset();
  rejectNodePairingLocallyMock.mockReset();
  renamePairedNodeLocallyMock.mockReset();
}

describe("botmax command execution", () => {
  it("maps devices list to gateway method", async () => {
    resetAllMocks();
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
    resetAllMocks();
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

  it("maps devices reject to local state store", async () => {
    resetAllMocks();
    rejectDevicePairingMock.mockResolvedValueOnce({
      requestId: "req-002",
      deviceId: "dev-002",
    });

    const result = await executeBotmaxGatewayCommand({
      command: "openclaw devices reject req-002 --json",
    });

    expect(rejectDevicePairingMock).toHaveBeenCalledWith("req-002");
    expect(runPluginCommandWithTimeoutMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.method).toBe("device.pair.reject");
  });

  it("maps devices remove to local state store", async () => {
    resetAllMocks();
    removePairedDeviceLocallyMock.mockResolvedValueOnce({
      deviceId: "dev-003",
    });

    const result = await executeBotmaxGatewayCommand({
      command: "openclaw devices remove dev-003 --json",
    });

    expect(removePairedDeviceLocallyMock).toHaveBeenCalledWith("dev-003");
    expect(runPluginCommandWithTimeoutMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.method).toBe("device.pair.remove");
  });

  it("maps devices clear to local state store", async () => {
    resetAllMocks();
    clearDevicePairingLocallyMock.mockResolvedValueOnce({
      removedDeviceIds: ["dev-1"],
      rejectedRequestIds: ["req-1"],
    });

    const result = await executeBotmaxGatewayCommand({
      command: "openclaw devices clear --yes --pending --json",
    });

    expect(clearDevicePairingLocallyMock).toHaveBeenCalledWith({
      includePending: true,
    });
    expect(runPluginCommandWithTimeoutMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.method).toBe("device.pair.clear");
  });

  it("maps devices rotate to local state store", async () => {
    resetAllMocks();
    rotateDeviceTokenLocallyMock.mockResolvedValueOnce({
      role: "operator",
      token: "secret",
      scopes: ["operator.read"],
      createdAtMs: 1,
      rotatedAtMs: 2,
    });

    const result = await executeBotmaxGatewayCommand({
      command:
        "openclaw devices rotate --device dev-1 --role operator --scope operator.read --json",
    });

    expect(rotateDeviceTokenLocallyMock).toHaveBeenCalledWith({
      deviceId: "dev-1",
      role: "operator",
      scopes: ["operator.read"],
    });
    expect(runPluginCommandWithTimeoutMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.method).toBe("device.token.rotate");
  });

  it("maps devices revoke to local state store", async () => {
    resetAllMocks();
    revokeDeviceTokenLocallyMock.mockResolvedValueOnce({
      role: "operator",
      revokedAtMs: 3,
    });

    const result = await executeBotmaxGatewayCommand({
      command: "openclaw devices revoke --device dev-1 --role operator --json",
    });

    expect(revokeDeviceTokenLocallyMock).toHaveBeenCalledWith({
      deviceId: "dev-1",
      role: "operator",
    });
    expect(runPluginCommandWithTimeoutMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.method).toBe("device.token.revoke");
  });

  it("maps nodes pending to local state store", async () => {
    resetAllMocks();
    listNodePairingLocallyMock.mockResolvedValueOnce({
      pending: [{ requestId: "node-req-1" }],
      paired: [],
    });

    const result = await executeBotmaxGatewayCommand({
      command: "openclaw nodes pending --json",
    });

    expect(listNodePairingLocallyMock).toHaveBeenCalledTimes(1);
    expect(runPluginCommandWithTimeoutMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.method).toBe("node.pair.list");
  });

  it("maps nodes approve to local state store", async () => {
    resetAllMocks();
    approveNodePairingLocallyMock.mockResolvedValueOnce({
      requestId: "node-req-2",
      node: { nodeId: "node-1", token: "node-token" },
    });

    const result = await executeBotmaxGatewayCommand({
      command: "openclaw nodes approve node-req-2 --json",
    });

    expect(approveNodePairingLocallyMock).toHaveBeenCalledWith("node-req-2");
    expect(runPluginCommandWithTimeoutMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.method).toBe("node.pair.approve");
  });

  it("maps nodes reject to local state store", async () => {
    resetAllMocks();
    rejectNodePairingLocallyMock.mockResolvedValueOnce({
      requestId: "node-req-3",
      nodeId: "node-3",
    });

    const result = await executeBotmaxGatewayCommand({
      command: "openclaw nodes reject node-req-3 --json",
    });

    expect(rejectNodePairingLocallyMock).toHaveBeenCalledWith("node-req-3");
    expect(runPluginCommandWithTimeoutMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.method).toBe("node.pair.reject");
  });

  it("maps nodes rename to local state store", async () => {
    resetAllMocks();
    renamePairedNodeLocallyMock.mockResolvedValueOnce({
      nodeId: "node-4",
      displayName: "QA iPhone",
    });

    const result = await executeBotmaxGatewayCommand({
      command: 'openclaw nodes rename --node "node-4" --name "QA iPhone" --json',
    });

    expect(renamePairedNodeLocallyMock).toHaveBeenCalledWith({
      query: "node-4",
      displayName: "QA iPhone",
    });
    expect(runPluginCommandWithTimeoutMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.method).toBe("node.rename");
  });

  it("forwards direct cli commands without using gateway call", async () => {
    resetAllMocks();
    runPluginCommandWithTimeoutMock.mockResolvedValueOnce({
      code: 0,
      stdout: '{"ok":true}',
      stderr: "",
    });

    const result = await executeBotmaxGatewayCommand({
      command: "openclaw health --json",
    });

    expect(runPluginCommandWithTimeoutMock).toHaveBeenCalledWith({
      argv: ["openclaw", "health", "--json"],
      timeoutMs: 30000,
    });
    expect(result.ok).toBe(true);
    expect(result.method).toBeUndefined();
  });

  it("rejects legacy gateway call transport", async () => {
    resetAllMocks();

    const result = await executeBotmaxGatewayCommand({
      command: "openclaw gateway call health --json",
    });

    expect(runPluginCommandWithTimeoutMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.output).toContain("no longer supported");
  });
});

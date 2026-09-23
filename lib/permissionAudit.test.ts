import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFolderPaths, classifyFolderPermissions } from "./permissionAudit";
import type { Directory } from "./permissions";
import type { FolderPermissions } from "./trimbleApi";
import type { FolderNode } from "./types";

const folder: FolderNode = { id: "f1", name: "03_DISENO_Y_MODELOS", parentId: "root" };

function permissions(acl: FolderPermissions["direct"]["acl"], inheritance = false): FolderPermissions {
  return { direct: { acl, inheritance }, inherited: {} };
}

const emptyDirectory: Directory = { usersById: new Map(), groupsById: new Map() };

describe("classifyFolderPermissions", () => {
  it("returns null for a folder with no direct entries", () => {
    assert.equal(classifyFolderPermissions(folder, "path", permissions({}), emptyDirectory), null);
  });

  it("flags a folder shared with everyone in the project", () => {
    const result = classifyFolderPermissions(
      folder,
      "path",
      permissions({ READ: ["tc-groups:*"] }),
      emptyDirectory
    );
    assert.equal(result?.openToEveryone, true);
    assert.deepEqual(result?.directFullAccessUsers, []);
  });

  it("flags a user with FULL_ACCESS granted directly", () => {
    const directory: Directory = {
      usersById: new Map([["u1", { id: "u1", firstName: "Alejandro", lastName: "Castellanos", email: "a@x.com" }]]),
      groupsById: new Map(),
    };
    const result = classifyFolderPermissions(
      folder,
      "path",
      permissions({ FULL_ACCESS: ["users:u1"] }),
      directory
    );
    assert.equal(result?.openToEveryone, false);
    assert.deepEqual(result?.directFullAccessUsers, ["Alejandro Castellanos"]);
  });

  it("does not flag a group with FULL_ACCESS as a direct full-access user", () => {
    const directory: Directory = {
      usersById: new Map(),
      groupsById: new Map([["g1", { id: "g1", name: "ARQUITECTURA" }]]),
    };
    const result = classifyFolderPermissions(
      folder,
      "path",
      permissions({ FULL_ACCESS: ["tc-groups:g1"] }),
      directory
    );
    assert.deepEqual(result?.directFullAccessUsers, []);
    assert.equal(result?.entries[0].principalType, "group");
  });

  it("carries the folder's own inheritance flag through", () => {
    const result = classifyFolderPermissions(
      folder,
      "path",
      permissions({ READ: ["tc-groups:*"] }, true),
      emptyDirectory
    );
    assert.equal(result?.inheritanceEnabled, true);
  });
});

describe("buildFolderPaths", () => {
  it("joins ancestor names with ' / ', root first", () => {
    const folders: FolderNode[] = [
      { id: "root", name: "SATORI", parentId: null },
      { id: "a", name: "01_GENERAL", parentId: "root" },
      { id: "b", name: "03_DISENO_Y_MODELOS", parentId: "a" },
    ];
    const paths = buildFolderPaths(folders);
    assert.equal(paths.get("root"), "SATORI");
    assert.equal(paths.get("a"), "SATORI / 01_GENERAL");
    assert.equal(paths.get("b"), "SATORI / 01_GENERAL / 03_DISENO_Y_MODELOS");
  });
});

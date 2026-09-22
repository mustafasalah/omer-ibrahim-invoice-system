import os from "node:os";

try {
  os.userInfo();
} catch {
  // Some constrained Windows child processes fail uv_os_get_passwd. The
  // TypeScript loader only uses the username to create a local pipe path.
  os.userInfo = () => ({
    username: process.env.USERNAME || "oims-test",
    uid: -1,
    gid: -1,
    shell: null,
    homedir: process.env.USERPROFILE || os.tmpdir(),
  });
}

# Homebrew Formula for ZClaw
# Place this file in: hashangit/homebrew-tap/Formula/zclaw.rb
#
# Users install with:
#   brew tap hashangit/tap
#   brew install zclaw

class Zclaw < Formula
  desc "Headless AI agent framework — LLM-powered automation for your terminal"
  homepage "https://github.com/hashangit/zclaw"
  url "https://registry.npmjs.org/zclaw-core/-/zclaw-core-0.3.0.tgz"
  sha256 "REPLACE_WITH_ACTUAL_SHA256"
  license "MIT"

  depends_on "node@20"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    assert_match "zclaw", shell_output("#{bin}/zclaw --version 2>&1 || true")
  end
end

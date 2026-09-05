class Hetzer < Formula
  desc "Zero-Plaintext Armor & Secret Interceptor for AI Agents"
  homepage "https://github.com/agunggnn/hetzer"
  url "https://registry.npmjs.org/hetzer/-/hetzer-0.3.0.tgz"
  license "Apache-2.0"

  depends_on "node"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    system "#{bin}/hetzer", "help"
  end
end

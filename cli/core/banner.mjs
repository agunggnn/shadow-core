export function getHetzerAsciiBanner({ colored = false } = {}) {
    const cCyan = colored ? "\x1b[36m" : "";
    const cGreen = colored ? "\x1b[32m" : "";
    const cBold = colored ? "\x1b[1m" : "";
    const cDim = colored ? "\x1b[2m" : "";
    const cReset = colored ? "\x1b[0m" : "";

    return [
        `${cCyan}       __`,
        `      /  \\_______`,
        `  ___[  ______/_/_   ${cBold}_  _ ___ _____ ____ ___ ___ ${cReset}`,
        `${cCyan} /_  _\\________/ /  ${cBold}| || | __|_   _|_  / __| _ \\${cReset}`,
        `${cCyan}   \\____________/   ${cBold}| __ | _|  | |  / /| _||   /${cReset}`,
        `${cGreen}    (o)(o)(o)(o)    ${cBold}|_||_|___| |_| /___|___|_|_\\${cReset}`,
        `${cDim} =======================================================${cReset}`,
        `  ${cBold}${cGreen}H E T Z E R${cReset}  ${cDim}•${cReset}  ${cCyan}Zero-Plaintext Armor for AI Agents${cReset}`,
        `  ${cDim}[Sub-2ms Vault] • [MCP Active] • [Universal Skills]${cReset}`,
        `${cDim} =======================================================${cReset}`,
    ].join("\n");
}

export function printHetzerBanner() {
    const isTty = process.stdout.isTTY;
    process.stdout.write(getHetzerAsciiBanner({ colored: Boolean(isTty) }) + "\n\n");
}

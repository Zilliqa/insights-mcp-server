/**
 * @typedef {Object} ValidatorData
 */
export type ValidatorData = {
  name: string; public_key: string; address: string; 
};

/**
 * Array containing the name, public key, and address for various nodes/entities.
 * This can be used to map human-readable names to on-chain identifiers.
 * @type {ValidatorData[]}
 */
export const validators = [
  {
    name: "Moonlet",
    public_key: "0xac184aafd750179178519b13b25a12c3bf18348a66de384751b8d1554f637ae6e667592b20580864029084917eed9e3f",
    address: "0xf35e17333bd4ad7b11e18f750afbcce14e4101b7"
  },
  {
    name: "Plunderswap",
    public_key: "0xa917cff83bb7accb48dd8cb2032f0a4b8c042fca3a5e079e2063c3bc4b790d597eb49c2a9d5b36447fd5479d6a439d12",
    address: "0x691682fca60fa6b702a0a69f60d045c08f404220"
  },
  {
    name: "TorchWallet.io",
    public_key: "0xa7bb1acf64dc1ecb1419c7e091e815a9ac84dc64603a01d69947e5e0f7c3b9268593e260cfd91ca8b84d9ebb56cc8b9a",
    address: "0xbb2cb8b573ec1ec4f77953128df7f1d08d9c34df"
  },
  {
    name: "2ZilMoon",
    public_key: "0x8c28b72c30559bc5eb37582985f9f83689304ce7a1075c18cc400544ec54183ad5c20af3a6463405e90177462a7a5f1d",
    address: "0xcdb0b23db1439b28689844fd093c478d73c0786a"
  },
  {
    name: "AlphaZIL",
    public_key: "0x88bc4afbb4585bae35a60684b704fba4ee442c71101fd7aeacbd489900f88b3f19c1e0014bb3adffc8c4d76e426e8049",
    address: "0x068c599686d2511ad709b8b4c578549a65d19491"
  },
  {
    name: "Amazing Pool",
    public_key: "0x98582ca0f588df19796e371bf9faa37ab81c4ab54de4467531a2770f0d556658260b33584815c2b95ebe466488826365",
    address: "0x1f0e86bc299cc66df2e5512a7786c3f528c0b5b6"
  },
  {
    name: "Luganodes",
    public_key: "0x906d30980d2b78763a93a4f6f51b80db698e562f35a2a6f38a22f4ccfba36d1edee2820bddf20d6a00762439e32a6fdf",
    address: "0x63ce81c023bb9f8a6ffa08fcf48ba885c21fcfbc"
  },
  {
    name: "Stake Shark",
    public_key: "0xb1dd63c2cf3e5618631d06ff36fff8da493481fdd5ed38d5a2e97efefad7e408c2adffbdf374fb956e355b22dfe0e7c9",
    address: "0xf7f4049e7472fc32805aae5bcce909419a34d254"
  },
  {
    name: "Lithium Digital",
    public_key: "0xa25244f770ac74fabb696b22bc4d4fe6677327bbbf9357df0814f7e7e5af3283db1d34ea072e4b8bc6a753b3b44e3514",
    address: "0xbd6ca237f30a86eea8cf9bf869677f3a0496a990"
  },
  {
    name: "CEX.IO",
    public_key: "0xa0028b7beaa6e7b668119e7d93ccf6686a5623aa18457a7b7b5cd9342f4c940435c0ce5c4717a0c3203a5474e9086ec2",
    address: "0x18925ce668b2bbc26dfe6f630f5c285d46b937ae"
  },
  {
    name: "Encapsulate",
    public_key: "0xa688860a92439b5e54e8caefcf16f9ebb7caf0ec5af9b86629803a04b75ca94fcaaff12df51a8dd6ac055f982a256535",
    address: "0x1311059dd836d7000dc673ea4cc834fe04e9933c"
  },
  {
    name: "Zillet",
    public_key: "0x99fcee2a0faf75d9d90c711c1e65ea76b2800bb0ed3ac68b25d026c2535bb6d4992487b0ff8d1cac388b33b3625b076b",
    address: "0x7e3a0aebbf8ec2f12a8a885cd663ee4a490f923f"
  },
  {
    name: "Citadel.one", 
    public_key: "0x95aa085615d0334285104af21275ccf64f35ccef1e0b98d23d018d086be60fe01b7b04169b6d69f41ef24e049dc1805c",
    address: "0xd12340c2d5a26e7f5c469b57ee81ee82c8cb7686"
  },
  {
    name: "Cryptech-Hacken",
    public_key: "0xa0e4e432f8afd9cbf3c9cfd1765ba6ec24b8299c7584dc0e4360be6200d62daafc2b385a8cb6b0b5e0dc9d99330a322b",
    address: "0x26322705fcbf5d3065707c408b6594912daa3488"
  },
  {
    name: "DTEAM",
    public_key: "0x899ac4d043b94e1fccf73a6aa6b595b63fa14a9e68dbdd7dfdc6a24b83c1445cd8d33912b0507b064354be02e017bb7a",
    address: "0x8776f1135b3583dbae79c8f7268a7e0d4c16462c"
  },
  {
    name: "PathrockNetwork",
    public_key: "0xa9271509db2abe65bb2df8ab4f2ddb5a5a476407204f141b2f7990ed0a35a2796a964d99ee0a167b2a8a99ceafa47529",
    address: "0xe67e119dcdc1168ec8089f4647702a72a0fcbc7f"
  },
  {
    name: "Stakefish",
    public_key: "0xb320a25984e7866f63b69837f5446dae58b4fa10facb97f084b54f9875e2af74c988ba8eed845c1176b87fa4e2165e07",
    address: "0x715f94264057df97e772ebdfe2c94a356244f142"
  },
  {
    name: "BlackNodes",
    public_key: "0xad6320c9c9a8bbfa16f57659cdbd4685672b7ba04d31df840f25dc1f3e6f17be1b92d14abec06f1c8ba16737f0f6e41a",
    address: "0x87297b0b63a0b93d3f7cafa9e0f4c849e92642eb"
  },
  {
    name: "Shardpool",
    public_key: "0x988791b3e2b0520c701c98474d8495e5928fae116742277cfc29f0ff74d8f535abeb3fb10179ebb1513fffd48c74075a",
    address: "0xe5e8158883a37449ae07fe70b69e658766b317fc"
  },
  {
    name: "RockX",
    public_key: "0xa551d1a0b8a1dbfbf27d41d551fc870c25286dbebf027e35f7db5ec2290310bd991e8be2e462671793ff855d1aa10e81",
    address: "0x60571e6c6d55109e6705d17956201a0cf39f1198"
  },
  {
    name: "Stakin",
    public_key: "0xb97697361626afa6c116723739d952f347b95d5eae60e38cd8d0c1d0cbfad1db09e6f76f22dacb6ddac36ab26c3c04c8",
    address: "0xba669cc6b49218624e84920dc8136a05411b1ec8"
  },
  {
    name: "Abra",
    public_key: "0x8e29c525dd03684c3faa3b7431c1f27a8bc7b5ec892d9e7539676d0915b96ac484ac478f5c0964d0af022e124c191e3e",
    address: "0xd3fc7d95bb87c3f9a2873dcf946e9672c2a2c1f1"
  },
  {
    name: "GZIL",
    public_key: "0xa15ac3726d3af22ec69edb47fac9e4b46b3b3642b8069213f8afeb92efae3c42badfbca5b49da338fa59b8d8842e0162",
    address: "0x9c65152d772767a7e5fca8f2cf21b3fdb91706af"
  },
  {
    name: "Huobi",
    public_key: "0xb461f58c3f3879d5ce75f88fbab9de80bd91d2e387dbc266ff2d31eb48eb79dc2ea7f95d2611c4bcb5b4b5b8379dda45",
    address: "0xb2d5dd48830ab8aec288a44ee868eee3251922bd"
  }
];

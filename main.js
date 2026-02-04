const revealElements = document.querySelectorAll(".reveal");

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.2 }
  );

  revealElements.forEach((el) => observer.observe(el));
} else {
  revealElements.forEach((el) => el.classList.add("visible"));
}

const statusEl = document.querySelector("[data-wallet-status]");
const chainEl = document.querySelector("[data-wallet-chain]");
const connectBtn = document.querySelector("[data-wallet-connect]");
const checkBtn = document.querySelector("[data-wallet-check]");

const setStatus = (status, chain) => {
  if (statusEl) statusEl.textContent = status;
  if (chainEl) chainEl.textContent = chain || "n/a";
};

const checkProvider = async () => {
  if (!window.ethereum) {
    setStatus("No provider detected", "n/a");
    return;
  }

  try {
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    setStatus("Provider detected", chainId);
  } catch (error) {
    setStatus("Provider error", "n/a");
  }
};

const connectWallet = async () => {
  if (!window.ethereum) {
    setStatus("Install a wallet to connect", "n/a");
    return;
  }

  try {
    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts",
    });
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    const display = accounts && accounts.length ? accounts[0] : "Connected";
    setStatus(display, chainId);
  } catch (error) {
    setStatus("Connection rejected", "n/a");
  }
};

if (connectBtn) {
  connectBtn.addEventListener("click", () => {
    connectWallet();
  });
}

if (checkBtn) {
  checkBtn.addEventListener("click", () => {
    checkProvider();
  });
}

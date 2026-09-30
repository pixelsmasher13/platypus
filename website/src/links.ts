import { useEffect, useState } from "react";

export const GITHUB_URL = "https://github.com/pixelsmasher13/platypus";
export const RELEASES_URL = `${GITHUB_URL}/releases/latest`;

// Installers are attached to each GitHub release with the version in their file
// names, so look them up on the latest release. Until that answers, or if an
// installer is missing, the buttons open the releases page instead.
export type DownloadLinks = { mac: string; windows: string };
const FALLBACK: DownloadLinks = { mac: RELEASES_URL, windows: RELEASES_URL };
type Asset = { name: string; browser_download_url: string };

let latest: Promise<DownloadLinks> | undefined;
function latestDownloads(): Promise<DownloadLinks> {
  latest ??= fetch("https://api.github.com/repos/pixelsmasher13/platypus/releases/latest")
    .then(response => (response.ok ? response.json() : Promise.reject(response.status)))
    .then(({ assets }: { assets: Asset[] }) => {
      const find = (suffix: string) => assets.find(asset => asset.name.endsWith(suffix))?.browser_download_url;
      return { mac: find("_aarch64.dmg") ?? RELEASES_URL, windows: find("_x64-setup.exe") ?? RELEASES_URL };
    })
    .catch(() => FALLBACK);
  return latest;
}

export function useDownloadLinks(): DownloadLinks {
  const [links, setLinks] = useState(FALLBACK);
  useEffect(() => {
    let active = true;
    void latestDownloads().then(found => { if (active) setLinks(found); });
    return () => { active = false; };
  }, []);
  return links;
}

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";

const ROOT_STYLE: React.CSSProperties = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif',
  height: "100vh",
  width: "100vw",
  background: "transparent",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "6px",
  boxSizing: "border-box",
  overflow: "hidden",
  WebkitUserSelect: "none",
  userSelect: "none",
};

const CARD_STYLE: React.CSSProperties = {
  background: "rgba(250, 250, 252, 0.94)",
  backdropFilter: "blur(20px) saturate(180%)",
  WebkitBackdropFilter: "blur(20px) saturate(180%)",
  borderRadius: "14px",
  boxShadow:
    "0 10px 30px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.08), inset 0 0 0 0.5px rgba(0, 0, 0, 0.06)",
  padding: "10px 14px 10px 12px",
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "center",
  gap: "12px",
  boxSizing: "border-box",
  position: "relative",
};

const ICON_STYLE: React.CSSProperties = {
  width: "44px",
  height: "44px",
  borderRadius: "10px",
  flex: "0 0 44px",
  objectFit: "contain",
  // Match the macOS notification look — slight inner shadow / border
  // hairline so the icon sits on the card rather than floats.
  boxShadow:
    "0 1px 2px rgba(0, 0, 0, 0.08), inset 0 0 0 0.5px rgba(0, 0, 0, 0.04)",
};

const TITLE_STYLE: React.CSSProperties = {
  flex: "1 1 auto",
  fontSize: "13.5px",
  fontWeight: 600,
  color: "#1d1d1f",
  lineHeight: 1.3,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const SUBTITLE_STYLE: React.CSSProperties = {
  fontSize: "11.5px",
  color: "#6e6e73",
  lineHeight: 1.3,
  marginTop: "1px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const TEXT_WRAP_STYLE: React.CSSProperties = {
  flex: "1 1 auto",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  minWidth: 0,
};

const BUTTON_STYLE: React.CSSProperties = {
  flex: "0 0 auto",
  fontSize: "12.5px",
  fontWeight: 600,
  color: "#1d1d1f",
  background: "rgba(255, 255, 255, 0.95)",
  border: "0.5px solid rgba(0, 0, 0, 0.12)",
  borderRadius: "8px",
  padding: "7px 14px",
  cursor: "pointer",
  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)",
  whiteSpace: "nowrap",
};

const CLOSE_STYLE: React.CSSProperties = {
  position: "absolute",
  top: "6px",
  left: "6px",
  width: "16px",
  height: "16px",
  borderRadius: "50%",
  background: "rgba(0, 0, 0, 0.08)",
  color: "#3a3a3c",
  fontSize: "10px",
  fontWeight: 700,
  border: "none",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  lineHeight: 1,
  opacity: 0,
  transition: "opacity 120ms ease",
};

// "Microsoft Teams" → "Teams" so the title fits a single tight line.
const shortenAppName = (name: string): string => {
  const trimmed = name.trim();
  if (trimmed.toLowerCase().startsWith("microsoft ")) {
    return trimmed.slice("Microsoft ".length);
  }
  return trimmed;
};

export const MeetingPopup = () => {
  const [appName, setAppName] = useState<string>("");
  const [closeVisible, setCloseVisible] = useState(false);

  useEffect(() => {
    const unlisten = listen<{ app_name: string }>("meeting-popup-data", (event) => {
      setAppName(event.payload.app_name);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const handleStart = () => {
    invoke("meeting_popup_start_recording").catch(() => {});
  };
  const handleDismiss = () => {
    invoke("meeting_popup_dismiss").catch(() => {});
  };

  const subtitle = appName
    ? `${shortenAppName(appName)} meeting detected`
    : "Detecting meeting…";

  return (
    <div
      style={ROOT_STYLE}
      onMouseEnter={() => setCloseVisible(true)}
      onMouseLeave={() => setCloseVisible(false)}
    >
      <div style={CARD_STYLE}>
        <button
          style={{ ...CLOSE_STYLE, opacity: closeVisible ? 1 : 0 }}
          onClick={handleDismiss}
          aria-label="Dismiss"
        >
          ×
        </button>
        <img src="/platypus-icon.png" alt="Platypus" style={ICON_STYLE} />
        <div style={TEXT_WRAP_STYLE}>
          <div style={TITLE_STYLE}>Platypus</div>
          <div style={SUBTITLE_STYLE}>{subtitle}</div>
        </div>
        <button style={BUTTON_STYLE} onClick={handleStart}>
          Start notes
        </button>
      </div>
    </div>
  );
};

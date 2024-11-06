import "ol/ol.css";

import { Fill, Icon, Style } from "ol/style";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@nextui-org/modal";
import { useEffect, useRef, useState } from "react";

import { Button } from "@nextui-org/button";
import Circle from "ol/geom/Circle";
import Feature from "ol/Feature";
import ImageLayer from "ol/layer/Image";
import Map from "ol/Map";
import Point from "ol/geom/Point";
import { Projection } from "ol/proj";
import Static from "ol/source/ImageStatic";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import View from "ol/View";
import { defaults as defaultControls } from "ol/control";
import { getCenter } from "ol/extent";

// Types
interface Location {
  coords: [number, number];
  profile: string;
}

interface DeskLocation {
  coords: [number, number];
  size: [number, number];
  id: string;
}

interface SelectedLocation {
  coords: number[];
  profile: string;
}

interface SelectedDesk {
  id: string;
  coords: number[];
}

// Constants
const MAP_EXTENT = [0, 0, 1024, 968];
const MIN_MAP_HEIGHT = 400;
const MAX_MAP_HEIGHT = 1200;
const HEADER_FOOTER_SPACE = 120;
const DEFAULT_MARKER_SIZE = 30;
const HOVER_MARKER_SIZE = 40;
const CLICK_MARKER_SIZE = 45;
const CLICK_ANIMATION_DURATION = 200;
const DESK_RADIUS = 25;

const DEFAULT_LOCATIONS: Location[] = [
  { coords: [176, 325], profile: "/profiles/profile1.jpeg" },
  { coords: [176, 94], profile: "/profiles/profile2.jpeg" },
  { coords: [232, 506], profile: "/profiles/profile3.jpeg" },
  { coords: [427, 506], profile: "/profiles/profile4.jpeg" },
  { coords: [309, 176], profile: "/profiles/profile1.jpeg" },
];

const DESK_LOCATIONS: DeskLocation[] = [
  {
    coords: [176, 255],
    size: [DESK_RADIUS * 2, DESK_RADIUS * 2],
    id: "desk-1",
  },
  {
    coords: [176, 177],
    size: [DESK_RADIUS * 2, DESK_RADIUS * 2],
    id: "desk-2",
  },
  {
    coords: [333, 506],
    size: [DESK_RADIUS * 2, DESK_RADIUS * 2],
    id: "desk-3",
  },
  {
    coords: [525, 506],
    size: [DESK_RADIUS * 2, DESK_RADIUS * 2],
    id: "desk-4",
  },
  {
    coords: [309, 329],
    size: [DESK_RADIUS * 2, DESK_RADIUS * 2],
    id: "desk-5",
  },
  {
    coords: [309, 250],
    size: [DESK_RADIUS * 2, DESK_RADIUS * 2],
    id: "desk-6",
  },
  { coords: [309, 96], size: [DESK_RADIUS * 2, DESK_RADIUS * 2], id: "desk-6" },
];

// Style cache for performance
const styleCache: { [key: string]: { [size: number]: Style } } = {};

const deskStyle = new Style({
  fill: new Fill({
    color: "rgba(0, 255, 0, 0.3)",
  }),
});

const deskHoverStyle = new Style({
  fill: new Fill({
    color: "rgba(0, 255, 0, 0.5)",
  }),
});

export default function MapComponent() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isDeskModalOpen, setIsDeskModalOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] =
    useState<SelectedLocation | null>(null);
  const [selectedDesk, setSelectedDesk] = useState<SelectedDesk | null>(null);
  const [mapHeight, setMapHeight] = useState("600px");

  // Utility functions
  const calculateMapHeight = () => {
    if (typeof window === "undefined") return;

    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const calculatedHeight = vh - HEADER_FOOTER_SPACE;
    let constrainedHeight = Math.min(
      Math.max(calculatedHeight, MIN_MAP_HEIGHT),
      MAX_MAP_HEIGHT,
    );

    if (vw < 1024) {
      constrainedHeight = 600;
    }

    setMapHeight(`${constrainedHeight}px`);
  };

  const createProfileStyle = async (
    profilePath: string,
    size: number = DEFAULT_MARKER_SIZE,
  ): Promise<Style> => {
    if (styleCache[profilePath]?.[size]) {
      return styleCache[profilePath][size];
    }

    return new Promise((resolve) => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) return resolve(new Style());

      const borderWidth = 3;
      const totalSize = size * 2 + borderWidth * 2;

      canvas.width = totalSize;
      canvas.height = totalSize;

      // Draw border
      context.beginPath();
      context.arc(
        totalSize / 2,
        totalSize / 2,
        size + borderWidth,
        0,
        2 * Math.PI,
      );
      context.fillStyle = "#e5e7eb";
      context.fill();

      // Create circular clipping path
      context.beginPath();
      context.arc(totalSize / 2, totalSize / 2, size, 0, 2 * Math.PI);
      context.clip();

      const img = new Image();

      img.crossOrigin = "anonymous";
      img.src = profilePath;

      img.onload = () => {
        context.drawImage(img, borderWidth, borderWidth, size * 2, size * 2);
        const style = new Style({
          image: new Icon({
            img: canvas,
            size: [totalSize, totalSize],
            anchor: [0.5, 0.5],
            anchorXUnits: "fraction",
            anchorYUnits: "fraction",
          }),
        });

        if (!styleCache[profilePath]) {
          styleCache[profilePath] = {};
        }
        styleCache[profilePath][size] = style;

        resolve(style);
      };

      img.onerror = () => {
        console.error(`Failed to load image: ${profilePath}`);
        resolve(new Style());
      };
    });
  };

  const createDeskFeature = (desk: DeskLocation): Feature => {
    const [x, y] = desk.coords;

    const feature = new Feature({
      geometry: new Circle([x, y], DESK_RADIUS),
      id: desk.id,
      type: "desk",
    });

    feature.setStyle(deskStyle);

    return feature;
  };

  // Handle window resize
  useEffect(() => {
    calculateMapHeight();
    window.addEventListener("resize", calculateMapHeight);

    return () => window.removeEventListener("resize", calculateMapHeight);
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current) return;

    const projection = new Projection({
      code: "xkcd-image",
      units: "pixels",
      extent: MAP_EXTENT,
    });

    const calculateInitialZoom = () => {
      if (!mapRef.current) return 1;

      return mapRef.current.clientWidth < 1024 ? 1 : 2;
    };

    const vectorSource = new VectorSource();
    const vectorLayer = new VectorLayer({ source: vectorSource });

    const deskVectorSource = new VectorSource();
    const deskVectorLayer = new VectorLayer({ source: deskVectorSource });

    const view = new View({
      projection: projection,
      center: getCenter(MAP_EXTENT),
      zoom: calculateInitialZoom(),
      maxZoom: 3.5,
      minZoom: 1,
      // extent: MAP_EXTENT,
      constrainOnlyCenter: true,
    });

    // Add zoom change listener
    view.on("change:resolution", () => {
      console.log("Current zoom level:", view.getZoom());
    });

    const map = new Map({
      target: mapRef.current,
      controls: defaultControls({
        zoom: true,
        rotate: false,
        attribution: false,
      }),
      layers: [
        new ImageLayer({
          source: new Static({
            url: "/mapTiles/floorplan-export.png",
            projection: projection,
            imageExtent: MAP_EXTENT,
          }),
        }),
        deskVectorLayer,
        vectorLayer,
      ],
      view: view,
    });

    // Initialize desks
    DESK_LOCATIONS.forEach((desk) => {
      deskVectorSource.addFeature(createDeskFeature(desk));
    });

    // Preload and initialize markers
    const initializeFeatures = async () => {
      const preloadPromises = DEFAULT_LOCATIONS.flatMap((location) => [
        createProfileStyle(location.profile, DEFAULT_MARKER_SIZE),
        createProfileStyle(location.profile, HOVER_MARKER_SIZE),
        createProfileStyle(location.profile, CLICK_MARKER_SIZE),
      ]);

      await Promise.all(preloadPromises);

      for (const location of DEFAULT_LOCATIONS) {
        const feature = new Feature({
          geometry: new Point(location.coords),
          profile: location.profile,
          type: "profile",
        });
        const style = await createProfileStyle(location.profile);

        feature.setStyle(style);
        vectorSource.addFeature(feature);
      }
    };

    initializeFeatures();

    // Handle hover effects
    let hoveredFeature: Feature | null = null;

    map.on("pointermove", async (event) => {
      const pixel = map.getEventPixel(event.originalEvent);
      const hit = map.hasFeatureAtPixel(pixel);

      map.getTargetElement().style.cursor = hit ? "pointer" : "";

      const feature = map.forEachFeatureAtPixel(
        pixel,
        (feature) => feature as Feature,
      );

      if (hoveredFeature && hoveredFeature !== feature) {
        if (hoveredFeature.get("type") === "profile") {
          const style = await createProfileStyle(hoveredFeature.get("profile"));

          hoveredFeature.setStyle(style);
        } else {
          hoveredFeature.setStyle(deskStyle);
        }
        hoveredFeature = null;
      }

      if (feature && hoveredFeature !== feature) {
        if (feature.get("type") === "profile") {
          const style = await createProfileStyle(
            feature.get("profile"),
            HOVER_MARKER_SIZE,
          );

          feature.setStyle(style);
        } else {
          feature.setStyle(deskHoverStyle);
        }
        hoveredFeature = feature;
      }
    });

    // Handle clicks
    map.on("click", async (event) => {
      // Log click coordinates
      const clickCoord = map.getCoordinateFromPixel(event.pixel);

      console.log("Click coordinates:", {
        x: Math.round(clickCoord[0]),
        y: Math.round(clickCoord[1]),
      });

      const clickedFeature = map.forEachFeatureAtPixel(
        event.pixel,
        (feature) => feature as Feature,
      );

      if (clickedFeature) {
        const featureType = clickedFeature.get("type");

        if (featureType === "profile") {
          const geometry = clickedFeature.getGeometry();

          if (geometry instanceof Point) {
            const coords = geometry.getCoordinates();

            setSelectedLocation({
              coords,
              profile: clickedFeature.get("profile"),
            });
            setIsOpen(true);

            const largeStyle = await createProfileStyle(
              clickedFeature.get("profile"),
              CLICK_MARKER_SIZE,
            );

            clickedFeature.setStyle(largeStyle);

            setTimeout(async () => {
              const normalStyle = await createProfileStyle(
                clickedFeature.get("profile"),
              );

              clickedFeature.setStyle(normalStyle);
            }, CLICK_ANIMATION_DURATION);
          }
        } else if (featureType === "desk") {
          const geometry = clickedFeature.getGeometry();

          if (geometry instanceof Circle) {
            const coords = geometry.getCenter();

            setSelectedDesk({
              id: clickedFeature.get("id"),
              coords,
            });
            setIsDeskModalOpen(true);
          }
        }
      }
    });

    // Ensure proper sizing
    setTimeout(() => map.updateSize(), 100);

    return () => map.setTarget(undefined);
  }, [mapHeight]);

  return (
    <div className="relative">
      <div
        ref={mapRef}
        className="rounded-lg"
        style={
          {
            width: "100%",
            maxWidth: "1200px",
            height: mapHeight,
            margin: "0 auto",
            "--ol-background-color": "transparent",
            "--ol-accent-background-color": "#fff",
            "--ol-subtle-background-color": "#fff",
          } as React.CSSProperties
        }
      />
      <Modal backdrop="blur" isOpen={isOpen} size="lg" onOpenChange={setIsOpen}>
        <ModalContent>
          <ModalHeader>Profile View</ModalHeader>
          <ModalBody>
            <div className="flex flex-col items-center">
              <img
                alt="Profile"
                className="w-full max-w-md rounded-lg shadow-lg"
                src={selectedLocation?.profile}
              />
              <p className="mt-4 text-sm text-gray-600">
                Location:{" "}
                {selectedLocation?.coords
                  ? `${Math.round(selectedLocation.coords[0])}, ${Math.round(
                      selectedLocation.coords[1],
                    )}`
                  : ""}
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button color="primary" onPress={() => setIsOpen(false)}>
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        backdrop="blur"
        isOpen={isDeskModalOpen}
        size="lg"
        onOpenChange={setIsDeskModalOpen}
      >
        <ModalContent>
          <ModalHeader>Book a Desk</ModalHeader>
          <ModalBody>
            <div className="flex flex-col items-center">
              <p className="text-lg font-semibold mb-4">
                Desk {selectedDesk?.id}
              </p>
              <p className="text-sm text-gray-600 mb-4">
                Location:{" "}
                {selectedDesk?.coords
                  ? `${Math.round(selectedDesk.coords[0])}, ${Math.round(selectedDesk.coords[1])}`
                  : ""}
              </p>
              <Button className="w-full" color="primary">
                Book This Desk
              </Button>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              color="danger"
              variant="light"
              onPress={() => setIsDeskModalOpen(false)}
            >
              Cancel
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

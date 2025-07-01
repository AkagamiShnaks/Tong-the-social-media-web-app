import { validateRequest } from "@/auth";
import prisma from "@/lib/prisma";
import streamServerClient from "@/lib/stream";
import { createUploadthing, FileRouter } from "uploadthing/next";
import { UploadThingError, UTApi } from "uploadthing/server";

const f = createUploadthing();

const APP_ID = process.env.NEXT_PUBLIC_UPLOADTHING_APP_ID;

if (!APP_ID) {
  throw new Error("Missing NEXT_PUBLIC_UPLOADTHING_APP_ID environment variable");
}

export const fileRouter = {
  avatar: f({
    image: { maxFileSize: "512KB" },
  })
    .middleware(async () => {
      const { user } = await validateRequest();

      if (!user) {
        throw new UploadThingError("Unauthorized");
      }

      return { user };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      try {
        const { user } = metadata;
        if (!user || !user.id) {
          throw new UploadThingError("Missing user metadata");
        }

        const oldAvatarUrl = user.avatarUrl;

        // Safely delete old avatar if it exists
        if (oldAvatarUrl?.includes(`/a/${APP_ID}/`)) {
          const key = oldAvatarUrl.split(`/a/${APP_ID}/`)[1];
          if (key) {
            try {
              await new UTApi().deleteFiles(key);
            } catch (err) {
              console.warn("Failed to delete old avatar:", err);
            }
          }
        }

        const newAvatarUrl = file.url.replace("/f/", `/a/${APP_ID}/`);

        await Promise.all([
          prisma.user.update({
            where: { id: user.id },
            data: { avatarUrl: newAvatarUrl },
          }),
          streamServerClient.partialUpdateUser({
            id: user.id,
            set: { image: newAvatarUrl },
          }),
        ]);

        return { avatarUrl: newAvatarUrl };
      } catch (error) {
        console.error("Error in avatar upload callback:", error);
        throw new UploadThingError("Failed to process avatar upload");
      }
    }),

  attachment: f({
    image: { maxFileSize: "4MB", maxFileCount: 5 },
    video: { maxFileSize: "64MB", maxFileCount: 5 },
  })
    .middleware(async () => {
      const { user } = await validateRequest();

      if (!user) {
        throw new UploadThingError("Unauthorized");
      }

      return {};
    })
    .onUploadComplete(async ({ file }) => {
      try {
        const media = await prisma.media.create({
          data: {
            url: file.url.replace("/f/", `/a/${APP_ID}/`),
            type: file.type.startsWith("image") ? "IMAGE" : "VIDEO",
          },
        });

        return { mediaId: media.id };
      } catch (error) {
        console.error("Error saving media:", error);
        throw new UploadThingError("Failed to save uploaded media");
      }
    }),
} satisfies FileRouter;

export type AppFileRouter = typeof fileRouter;

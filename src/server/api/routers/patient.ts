import { TRPCError } from "@trpc/server";
import { desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";

import { appointment, patientProfile, user } from "@/server/db/schema";
import {
  createTRPCRouter,
  protectedProcedure,
  roleProcedure,
} from "../trpc";

const upsertPatientSchema = z.object({
  dateOfBirth: z.string().optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  bloodGroup: z
    .enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"])
    .optional(),
  phone: z.string().min(7).max(15).optional(),
  address: z.string().max(500).optional(),
  emergencyContactName: z.string().max(100).optional(),
  emergencyContactPhone: z.string().max(15).optional(),
  allergies: z.string().max(500).optional(),
});

export const patientRouter = createTRPCRouter({
  // Get own profile (patient)
  getMyProfile: protectedProcedure.query(async ({ ctx }) => {
    const profile = await ctx.db.query.patientProfile.findFirst({
      where: eq(patientProfile.userId, ctx.session.user.id),
      with: {
        user: { columns: { id: true, name: true, email: true, image: true } },
      },
    });
    return profile ?? null;
  }),

  // Create or update own profile
  upsertMyProfile: protectedProcedure
    .input(upsertPatientSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.patientProfile.findFirst({
        where: eq(patientProfile.userId, ctx.session.user.id),
      });

      if (existing) {
        const [updated] = await ctx.db
          .update(patientProfile)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(patientProfile.userId, ctx.session.user.id))
          .returning();
        return updated;
      }

      const [created] = await ctx.db
        .insert(patientProfile)
        .values({ userId: ctx.session.user.id, ...input })
        .returning();
      return created;
    }),

  // Staff: list all patients with search
  list: roleProcedure("admin", "doctor", "receptionist")
    .input(
      z.object({
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { search, limit, offset } = input;

      const patients = await ctx.db.query.patientProfile.findMany({
        with: {
          user: { columns: { id: true, name: true, email: true, image: true } },
        },
        where: search
          ? or(ilike(user.name, `%${search}%`), ilike(user.email, `%${search}%`))
          : undefined,
        limit,
        offset,
        orderBy: [desc(patientProfile.createdAt)],
      });

      return patients;
    }),

  // Staff: get a single patient with full history
  getById: roleProcedure("admin", "doctor", "receptionist")
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const profile = await ctx.db.query.patientProfile.findFirst({
        where: eq(patientProfile.id, input.id),
        with: {
          user: { columns: { id: true, name: true, email: true, image: true } },
          appointments: {
            // BUG WAS HERE: orderBy: [desc] passed the bare `desc`
            // function instead of calling it on a column. `desc` has
            // type `(column) => SQL`, which is not assignable to
            // `SQL | AnyColumn` — hence the error. Fixed by calling
            // desc(appointment.scheduledAt) to actually produce an
            // SQL ORDER BY expression.
            orderBy: [desc(appointment.scheduledAt)],
            limit: 10,
            with: { doctor: { with: { user: { columns: { name: true } } } } },
          },
          prescriptions: {
            orderBy: (prescriptionTable, { desc: descOp }) => [
              descOp(prescriptionTable.createdAt),
            ],
            limit: 10,
          },
        },
      });

      if (!profile) throw new TRPCError({ code: "NOT_FOUND" });
      return profile;
    }),
});
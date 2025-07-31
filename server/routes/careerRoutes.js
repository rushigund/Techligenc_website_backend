import express from "express";
import { body, validationResult } from "express-validator";
import JobListing from "../models/JobListing.js";
import { authenticateToken, authorizeRoles } from "../middleware/auth.js";
import { updateSingleContentItem } from "../utils/contentIngestor.js";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Fix for ES module: define __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Ensure 'uploads' directory exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
  console.log("📁 'uploads' directory created.");
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = uuidv4();
    const fileExtension = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + fileExtension);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, DOC, and DOCX are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// GET all jobs
router.get("/career/jobs", async (req, res) => {
  try {
    const jobListings = await JobListing.find({});
    res.json({
      success: true,
      message: "Job listings fetched successfully!",
      data: jobListings,
    });
  } catch (error) {
    console.error("Error fetching job listings:", error);
    res.status(500).json({ success: false, message: "Failed to fetch job listings", error: error.message });
  }
});

// Apply to job
router.post(
  "/career/apply",
  upload.single("resume"),
  [
    body("fullName").notEmpty().withMessage("Full name is required."),
    body("email").isEmail().withMessage("Valid email is required."),
    body("phone").notEmpty().withMessage("Phone number is required."),
    body("jobTitle").notEmpty().withMessage("Job title is required."),
    body("jobDepartment").notEmpty().withMessage("Job department is required."),
    body("jobLocation").notEmpty().withMessage("Job location is required."),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, message: "Validation failed", errors: errors.array() });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: "Resume file is required." });
    }

    try {
      const newApplication = {
        fullName: req.body.fullName,
        email: req.body.email,
        phone: req.body.phone,
        jobTitle: req.body.jobTitle,
        jobDepartment: req.body.jobDepartment,
        jobLocation: req.body.jobLocation,
        coverLetter: req.body.coverLetter || "",
        resumePath: req.file.path,
        submittedAt: new Date(),
      };

      console.log("New Job Application Received:", newApplication);

      res.status(200).json({
        success: true,
        message: "Your job application has been submitted successfully!",
      });
    } catch (error) {
      console.error("Error submitting application:", error);
      if (req.file) fs.unlink(req.file.path, () => {});
      res.status(500).json({ success: false, message: "Failed to submit application", error: error.message });
    }
  }
);

// Admin routes
router.post(
  "/career/jobs",
  authenticateToken,
  authorizeRoles("admin"),
  [
    body("title").notEmpty().withMessage("Job title is required."),
    body("department").notEmpty().withMessage("Department is required."),
    body("location").notEmpty().withMessage("Location is required."),
    body("type").notEmpty().withMessage("Job type is required."),
    body("salary").notEmpty().withMessage("Salary is required."),
    body("description").notEmpty().withMessage("Description is required."),
    body("skills").isArray().withMessage("Skills must be an array."),
    body("skills.*").notEmpty().withMessage("Each skill cannot be empty."),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: "Validation failed", errors: errors.array() });
    }

    try {
      const newJob = new JobListing(req.body);
      await newJob.save();
      await updateSingleContentItem("job_listing", newJob, "upsert");

      res.status(201).json({
        success: true,
        message: "Job listing added successfully!",
        data: newJob,
      });
    } catch (error) {
      console.error("Error adding job listing:", error);
      res.status(500).json({ success: false, message: "Failed to add job listing", error: error.message });
    }
  }
);

router.put(
  "/career/jobs/:jobId",
  authenticateToken,
  authorizeRoles("admin"),
  [
    body("title").optional().notEmpty(),
    body("department").optional().notEmpty(),
    body("location").optional().notEmpty(),
    body("type").optional().notEmpty(),
    body("salary").optional().notEmpty(),
    body("description").optional().notEmpty(),
    body("skills").optional().isArray(),
    body("skills.*").optional().notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: "Validation failed", errors: errors.array() });
    }

    try {
      const { jobId } = req.params;
      const updatedJob = await JobListing.findByIdAndUpdate(jobId, req.body, {
        new: true,
        runValidators: true,
      });

      if (!updatedJob) {
        return res.status(404).json({ success: false, message: "Job not found" });
      }

      await updateSingleContentItem("job_listing", updatedJob, "upsert");

      res.json({
        success: true,
        message: "Job listing updated successfully!",
        data: updatedJob,
      });
    } catch (error) {
      console.error("Error updating job listing:", error);
      res.status(500).json({ success: false, message: "Failed to update job listing", error: error.message });
    }
  }
);

router.delete(
  "/career/jobs/:jobId",
  authenticateToken,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const { jobId } = req.params;
      const deletedJob = await JobListing.findByIdAndDelete(jobId);

      if (!deletedJob) {
        return res.status(404).json({ success: false, message: "Job not found" });
      }

      await updateSingleContentItem("job_listing", deletedJob, "delete");

      res.json({
        success: true,
        message: "Job listing deleted successfully!",
        data: null,
      });
    } catch (error) {
      console.error("Error deleting job listing:", error);
      res.status(500).json({ success: false, message: "Failed to delete job listing", error: error.message });
    }
  }
);

export default router;

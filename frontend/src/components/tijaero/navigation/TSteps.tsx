/**
 * TSteps - Standardized stepper/wizard component
 * 
 * Multi-step form wizard with progress indication.
 * 
 * @example
 * ```tsx
 * <TSteps
 *   steps={[
 *     { id: "details", label: "Order Details" },
 *     { id: "items", label: "Line Items" },
 *     { id: "review", label: "Review" },
 *   ]}
 *   activeStep={activeStep}
 *   onStepClick={setActiveStep}
 * />
 * ```
 */

import React from "react";
import {
  Stepper,
  Step,
  StepLabel,
  StepButton,
  StepContent,
  Box,
  Typography,
  Paper,
  MobileStepper,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { TButton } from "../base/TButton";
import KeyboardArrowLeftIcon from "@mui/icons-material/KeyboardArrowLeft";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";

export interface TStepConfig {
  /** Step ID */
  id: string | number;
  /** Step label */
  label: string;
  /** Optional description */
  description?: string;
  /** Optional icon */
  icon?: React.ReactNode;
  /** Step completed state */
  completed?: boolean;
  /** Step error state */
  error?: boolean;
  /** Step disabled state */
  disabled?: boolean;
  /** Step content (for vertical orientation) */
  content?: React.ReactNode;
}

export interface TStepsProps {
  /** Step configurations */
  steps: TStepConfig[];
  /** Current active step (index or id) */
  activeStep: number | string;
  /** Step click handler (for non-linear steppers) */
  onStepClick?: (step: number | string) => void;
  /** Orientation */
  orientation?: "horizontal" | "vertical";
  /** Allow clicking on completed steps */
  nonLinear?: boolean;
  /** Alternative label placement */
  alternativeLabel?: boolean;
  /** Show step connector */
  connector?: boolean;
  /** Next button handler */
  onNext?: () => void;
  /** Back button handler */
  onBack?: () => void;
  /** Finish button handler */
  onFinish?: () => void;
  /** Show navigation buttons */
  showNavigation?: boolean;
  /** Next button disabled */
  nextDisabled?: boolean;
  /** Custom styles */
  sx?: Record<string, unknown>;
}

export const TSteps: React.FC<TStepsProps> = ({
  steps,
  activeStep,
  onStepClick,
  orientation = "horizontal",
  nonLinear = false,
  alternativeLabel = false,
  connector = true,
  onNext,
  onBack,
  onFinish,
  showNavigation = false,
  nextDisabled = false,
  sx,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  // Get active step index
  const getActiveIndex = (): number => {
    if (typeof activeStep === "number") return activeStep;
    const index = steps.findIndex((s) => s.id === activeStep);
    return index >= 0 ? index : 0;
  };

  const activeIndex = getActiveIndex();
  const isLastStep = activeIndex === steps.length - 1;
  const isFirstStep = activeIndex === 0;

  // Handle step click
  const handleStepClick = (index: number) => {
    if (nonLinear && onStepClick) {
      const step = steps[index];
      onStepClick(step.id);
    }
  };

  // Mobile stepper for small screens
  if (isMobile && orientation === "horizontal") {
    return (
      <Paper
        square
        elevation={0}
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          bgcolor: "background.default",
          ...sx,
        }}
      >
        <Typography sx={{ mt: 2, mb: 1, fontWeight: 500 }}>
          Step {activeIndex + 1}: {steps[activeIndex]?.label}
        </Typography>
        <MobileStepper
          variant="dots"
          steps={steps.length}
          position="static"
          activeStep={activeIndex}
          sx={{ width: "100%", flexGrow: 1 }}
          nextButton={
            showNavigation ? (
              <TButton
                size="small"
                onClick={isLastStep ? onFinish : onNext}
                disabled={nextDisabled}
                endIcon={!isLastStep && <KeyboardArrowRightIcon />}
              >
                {isLastStep ? "Finish" : "Next"}
              </TButton>
            ) : (
              <Box />
            )
          }
          backButton={
            showNavigation ? (
              <TButton
                size="small"
                variant="secondary"
                onClick={onBack}
                disabled={isFirstStep}
                startIcon={<KeyboardArrowLeftIcon />}
              >
                Back
              </TButton>
            ) : (
              <Box />
            )
          }
        />
      </Paper>
    );
  }

  // Vertical stepper with content
  if (orientation === "vertical") {
    return (
      <Box sx={sx}>
        <Stepper activeStep={activeIndex} orientation="vertical">
          {steps.map((step) => (
            <Step key={step.id} completed={step.completed}>
              <StepLabel
                error={step.error}
                optional={
                  step.description && (
                    <Typography variant="caption">{step.description}</Typography>
                  )
                }
                icon={step.completed ? <CheckCircleIcon color="success" /> : step.icon}
              >
                {step.label}
              </StepLabel>
              <StepContent>
                {step.content}
                {showNavigation && (
                  <Box sx={{ mt: 2, display: "flex", gap: 1 }}>
                    <TButton
                      size="small"
                      onClick={isLastStep ? onFinish : onNext}
                      disabled={nextDisabled}
                    >
                      {isLastStep ? "Finish" : "Continue"}
                    </TButton>
                    <TButton
                      variant="secondary"
                      size="small"
                      onClick={onBack}
                      disabled={isFirstStep}
                    >
                      Back
                    </TButton>
                  </Box>
                )}
              </StepContent>
            </Step>
          ))}
        </Stepper>
      </Box>
    );
  }

  // Horizontal stepper
  return (
    <Box sx={sx}>
      <Stepper
        activeStep={activeIndex}
        alternativeLabel={alternativeLabel}
        nonLinear={nonLinear}
        connector={connector ? undefined : null}
      >
        {steps.map((step, index) => (
          <Step key={step.id} completed={step.completed} disabled={step.disabled}>
            {nonLinear ? (
              <StepButton onClick={() => handleStepClick(index)}>
                <StepLabel
                  error={step.error}
                  icon={step.completed ? <CheckCircleIcon color="success" /> : step.icon}
                >
                  {step.label}
                </StepLabel>
              </StepButton>
            ) : (
              <StepLabel
                error={step.error}
                optional={
                  step.description && (
                    <Typography variant="caption">{step.description}</Typography>
                  )
                }
                icon={step.completed ? <CheckCircleIcon color="success" /> : step.icon}
              >
                {step.label}
              </StepLabel>
            )}
          </Step>
        ))}
      </Stepper>

      {showNavigation && (
        <Box sx={{ display: "flex", justifyContent: "space-between", mt: 3, pt: 2, borderTop: 1, borderColor: "divider" }}>
          <TButton
            variant="secondary"
            onClick={onBack}
            disabled={isFirstStep}
            startIcon={<KeyboardArrowLeftIcon />}
          >
            Back
          </TButton>
          <TButton
            onClick={isLastStep ? onFinish : onNext}
            disabled={nextDisabled}
            endIcon={!isLastStep && <KeyboardArrowRightIcon />}
          >
            {isLastStep ? "Finish" : "Next"}
          </TButton>
        </Box>
      )}
    </Box>
  );
};

export default TSteps;

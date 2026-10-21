terraform {
  required_version = ">= 1.6"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

# The subscription ID is NOT written here. Terraform reads it from the
# ARM_SUBSCRIPTION_ID environment variable, so no IDs end up in Git.
provider "azurerm" {
  features {
    # Application Insights auto-creates a "Smart Detection" action group that
    # Terraform doesn't manage. Without this, destroy fails because the
    # resource group isn't empty.
    resource_group {
      prevent_deletion_if_contains_resources = false
    }
  }
}
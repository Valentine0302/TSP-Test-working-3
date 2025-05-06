document.addEventListener("DOMContentLoaded", async () => {
  console.log("DOM loaded, initializing script...");
  
  // Set current year in footer
  document.getElementById("currentYear").textContent = new Date().getFullYear();
  
  // Load ports and container types
  await loadPorts();
  await loadContainerTypes();
  
  // Set up form submission
  const form = document.getElementById("calculatorForm");
  form.addEventListener("submit", handleFormSubmit);
});

// Load ports from API
async function loadPorts() {
  console.log("Loading ports from /api/public/ports...");
  try {
    const response = await fetch("/api/public/ports");
    if (!response.ok) {
      throw new Error("Failed to fetch ports");
    }
    
    const ports = await response.json();
    console.log("Ports loaded:", ports);
    
    const portsByRegion = {};
    ports.forEach(port => {
      if (!portsByRegion[port.region]) {
        portsByRegion[port.region] = [];
      }
      portsByRegion[port.region].push(port);
    });
    
    const originSelect = document.getElementById("origin");
    const destinationSelect = document.getElementById("destination");
    
    originSelect.innerHTML = 	"<option value=\"\">Select origin port</option>";
    destinationSelect.innerHTML = "<option value=\"\">Select destination port</option>";
    
    Object.entries(portsByRegion).forEach(([region, regionPorts]) => {
      const originGroup = document.createElement("optgroup");
      originGroup.label = region;
      
      const destinationGroup = document.createElement("optgroup");
      destinationGroup.label = region;
      
      regionPorts.forEach(port => {
        const originOption = document.createElement("option");
        originOption.value = port.id;
        // MODIFIED: Improved display logic for port text
        if (port.code && port.code.trim() !== "") {
          originOption.textContent = `${port.name}, ${port.country} (${port.code})`;
        } else {
          originOption.textContent = `${port.name}, ${port.country}`;
        }
        originGroup.appendChild(originOption);
        
        const destinationOption = document.createElement("option");
        destinationOption.value = port.id;
        // MODIFIED: Improved display logic for port text
        if (port.code && port.code.trim() !== "") {
          destinationOption.textContent = `${port.name}, ${port.country} (${port.code})`;
        } else {
          destinationOption.textContent = `${port.name}, ${port.country}`;
        }
        destinationGroup.appendChild(destinationOption);
      });
      
      originSelect.appendChild(originGroup);
      destinationSelect.appendChild(destinationGroup);
    });
  } catch (error) {
    console.error("Error loading ports:", error);
    alert("Failed to load ports. Please refresh the page and try again.");
  }
}

// Load container types from API
async function loadContainerTypes() {
  console.log("Loading container types from /api/public/container-types...");
  try {
    const response = await fetch("/api/public/container-types");
    if (!response.ok) {
      throw new Error("Failed to fetch container types");
    }
    
    const containerTypes = await response.json();
    console.log("Container types loaded:", containerTypes);
    
    const containerTypeSelect = document.getElementById("containerType");
    containerTypeSelect.innerHTML = "<option value=\"\">Select container type</option>";
    
    containerTypes.forEach(containerType => {
      const option = document.createElement("option");
      option.value = containerType.name; 
      option.textContent = `${containerType.name} - ${containerType.description || ""}`;
      containerTypeSelect.appendChild(option);
    });
  } catch (error) {
    console.error("Error loading container types:", error);
    alert("Failed to load container types. Please refresh the page and try again.");
  }
}

// Handle form submission
async function handleFormSubmit(event) {
  event.preventDefault();
  
  const form = event.target;
  const submitButton = form.querySelector("button[type='submit']");
  const originalButtonText = submitButton.textContent;
  
  submitButton.textContent = "Calculating...";
  submitButton.disabled = true;
  
  try {
    const formData = new FormData(form);
    const data = {
      originPort: formData.get("origin"), // This is port ID
      destinationPort: formData.get("destination"), // This is port ID
      containerType: formData.get("containerType"),
      weight: 20000, 
      email: formData.get("email")
    };
    
    console.log("Sending data to API for calculation:", data);
    
    const response = await fetch("/api/calculate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to calculate rate: ${response.status} - ${JSON.stringify(errorData)}`);
    }
    
    const result = await response.json();
    console.log("API response for calculation:", result);
    
    displayResults(data, result);
  } catch (error) {
    console.error("Error during calculation:", error);
    alert(`An error occurred while calculating the rate: ${error.message}`);
  } finally {
    submitButton.textContent = originalButtonText;
    submitButton.disabled = false;
  }
}

// Display calculation results
function displayResults(data, result) {
  console.log("Displaying results:", result);
  
  const originSelect = document.getElementById("origin");
  const destinationSelect = document.getElementById("destination");
  const containerTypeSelect = document.getElementById("containerType");
  
  const originOption = originSelect.options[originSelect.selectedIndex];
  const destinationOption = destinationSelect.options[destinationSelect.selectedIndex];
  const containerTypeOption = containerTypeSelect.options[containerTypeSelect.selectedIndex];
  
  document.getElementById("routeDisplay").textContent = `${originOption.textContent.split(" (")[0]} 	→ ${destinationOption.textContent.split(" (")[0]}`;
  document.getElementById("containerDisplay").textContent = containerTypeOption.textContent.split(" - ")[0];
  document.getElementById("dateDisplay").textContent = new Date().toLocaleDateString();
  
  const minRateValue = result.rateDetails?.minRate || result.minRate || result.min_rate || 0;
  const maxRateValue = result.rateDetails?.maxRate || result.maxRate || result.max_rate || 0;
  let avgRateValue = result.rate || result.rateDetails?.finalRate || result.avgRate || result.avg_rate || 0;

  if (avgRateValue === 0 && (minRateValue !== 0 || maxRateValue !== 0)) {
    avgRateValue = Math.round((parseFloat(minRateValue) + parseFloat(maxRateValue)) / 2);
  }
  
  console.log("Rate values for display:", { minRateValue, maxRateValue, avgRateValue });
  
  document.getElementById("minRate").textContent = `$${minRateValue}`;
  document.getElementById("maxRate").textContent = `$${maxRateValue}`;
  
  const rateIndicatorContainer = document.querySelector(".mb-4");
  if (rateIndicatorContainer) {
    rateIndicatorContainer.innerHTML = `
      <p class="text-sm text-gray-500 mb-1">Rate Range (USD)</p>
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium">Min: $${minRateValue}</span>
        <span class="text-sm font-medium bg-blue-600 text-white px-3 py-1 rounded">Avg: $${avgRateValue}</span>
        <span class="text-sm font-medium">Max: $${maxRateValue}</span>
      </div>
    `;
  } else {
    console.error("Rate indicator container not found");
    const avgRateElement = document.getElementById("avgRate");
    if (avgRateElement) {
      avgRateElement.textContent = `$${avgRateValue}`;
      avgRateElement.style.fontWeight = "bold";
      avgRateElement.style.color = "white";
      avgRateElement.style.backgroundColor = "#2563eb";
      avgRateElement.style.padding = "4px 8px";
      avgRateElement.style.borderRadius = "4px";
      const parentElement = avgRateElement.parentElement;
      if (parentElement) {
        parentElement.style.visibility = "visible";
        parentElement.style.display = "block";
      }
    } else {
      console.error("avgRate element not found in DOM");
    }
  }
  
  const sourceCountElement = document.getElementById("sourceCount");
  if (sourceCountElement) {
    sourceCountElement.textContent = result.rateDetails?.sourceCount || result.sourceCount || result.source_count || "3";
  }
  
  const reliabilityElement = document.getElementById("reliability");
  if (reliabilityElement) {
    let reliabilityValue = result.rateDetails?.reliabilityScore || result.reliability || result.reliability_score || 0.85;
    if (typeof reliabilityValue === "number") {
      reliabilityValue = `${Math.round(reliabilityValue * 100)}%`;
    } else if (reliabilityValue && !reliabilityValue.toString().includes("%")) {
      reliabilityValue = `${reliabilityValue}%`;
    }
    reliabilityElement.textContent = reliabilityValue;
  }
  
  const resultContainer = document.getElementById("resultContainer");
  if (resultContainer) {
    resultContainer.classList.remove("hidden");
    resultContainer.scrollIntoView({ behavior: "smooth" });
  } else {
    console.error("resultContainer element not found in DOM");
  }
}

